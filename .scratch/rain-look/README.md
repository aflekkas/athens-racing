# Rain appearance evidence

Eight paired WebP images cover Riviera/Penteli × day/night × chase/cockpit. Each pair is **before (left), after (right)** at the same route station (`route.start + 120`), camera transform, wetness (0.8), car (Mini), rain intensity (1), 960×600 resolution and simulated camera/car speed (25 m/s). The capture harness is `tools/rain-look-browser.mjs`; run it through `tools/browser-slot.sh`. Baseline files come from commit `c0dca6734bb82a53889f9d875fbb9d12ec5ecbfe`.

## Diagnosis

- Two fixed-depth, repeating texture planes made broad pale bars that moved vertically regardless of driving speed or direction. They had no individual depth, perspective size or local illumination.
- Wet asphalt was only darkened. The regular puddle atlas had no roughness response, so road lighting remained matte.
- Tyre spray already existed, but its static soft discs looked like two anchored puffs.
- Cockpit glass already had wipers and an alpha overlay. Four beads repeated in a visible grid; models without physical wipers still received the wipe mask.
- Heavy rain already has overcast lighting and 30× atmospheric haze in `env.js`. This supplies the low-contrast distant veil; it does not need another fullscreen pass.

## Changes

- One instanced draw of deterministic, world-space streak quads, with perspective depth, tapered subpixel widths, soft ends, varied fall rates, and wind plus camera-relative velocity. No CPU particle simulation. Default locked look: 320 quads; Potato: 64. Rain intensity scales opacity and count. Existing legacy weather tiers remain bounded at 480/640.
- Vertex lighting uses the existing player beam and four nearest street lamps. Distant rain fades into the existing fog.
- Wetness darkens asphalt and lowers roughness, including small irregular puddle patches; existing sky IBL and analytic lamp/headlamp specular provide soft reflections. No new reflection, shadow or post-processing pass.
- Existing 18-card tyre spray pool becomes lower, wider, dimmer and trails farther behind the tyres, with subtle moving mist variation; speed and road wetness still control size/opacity. Existing online suppression is preserved.
- One non-repeating windscreen bead mask with ambient-sensitive highlights. Existing wiper geometry and sweep timing clear it; cars without wipers shed beads with speed.

## Validation and cost

See `metrics.json` for paired draw counts, triangle counts, frame samples and camera transforms. Timings use synchronous one-pixel readback on SwiftShader; they are software-renderer measurements, not hardware-GPU predictions. World loading/shader compilation is excluded.

All source and evidence land through a private index and compare-and-swap update of `prod`; the shared checkout and index are untouched. Required gates run on a clean git archive of the exact final candidate. No push or deploy.

Measured draw delta is 0 in every paired view; triangle delta is +636. Potato adds 124 triangles over the old two planes. Added static seed data: 10,232 bytes; added textures and render passes: zero.

| View | Before ms | After ms | Delta ms |
|---|---:|---:|---:|
| riviera-day-chase | 1396.1 | 1196.4 | -199.7 |
| riviera-day-cockpit | 1335.6 | 1348.5 | +12.9 |
| riviera-night-chase | 1637.0 | 1199.5 | -437.5 |
| riviera-night-cockpit | 1812.9 | 1475.0 | -337.9 |
| penteli-day-chase | 1536.7 | 1445.2 | -91.5 |
| penteli-day-cockpit | 1673.0 | 1680.0 | +7.0 |
| penteli-night-chase | 1510.7 | 1514.3 | +3.6 |
| penteli-night-cockpit | 1530.4 | 2650.0 | +1119.6 |

Median paired delta: -43.9 ms. Mean paired delta: +9.6 ms; individual view deltas range from -437.5 to +1119.6 ms. These full-scene SwiftShader timings on a shared VPS are noisy and do not establish a hardware-GPU speedup or regression. The median is used because the first readback can include queued warm-up work; raw samples are retained, and p95 is not used for conclusions.

Browser rendering checks passed at 0/25/50 m/s; Potato=64, normal=320, quarter rain=80, dry=0. Wiper/no-wiper uniforms and speed clearing were checked. No shader or JavaScript errors; the local server returned expected 404s for `/api/auth/config` and `/release.json` in both phases. All eight before/after pairs were visually inspected.

The cockpit source fingerprint was regenerated with `tools/pov-camera-mask.mjs` through the browser slot. All 156 opaque/aperture PNG masks are byte-identical to the parent, and all 78 geometry audits are unchanged. Only the two rain-related source hashes changed; no duplicate mask images are added. See `cockpit-mask-check.json`.
