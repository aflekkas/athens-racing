# Bus suspension: reproduction and evidence

Baseline: `935cc47c6b0521a9b9927adc8e784452cbece9b8` (production at the start of
this task, including the playable-fleet follow-ups). Frozen source is retained
as `physics-before.js` and `cars-before.js`.

The actual Riviera baseline reproduces the fault in chase and cockpit:

| Maneuver | Peak roll | Peak pitch | Frames with an unloaded patch / 360 |
| --- | ---: | ---: | ---: |
| 50 km/h cruise | 0.35° | 0.29° | 0 |
| 80 km/h cruise | 0.53° | 0.18° | 0 |
| Lane change | 1.45° | 0.32° | 0 |
| Junction turn (90° steering target; 100° actual heading change) | 8.63° | 1.23° | 43 |
| Roughly 80 mm kerb | 6.02° | 0.43° | 1 |
| Authored dirt hump (350 mm high) | 0.62° | 5.52° | 21 |

The corrected game run reduces the junction peak to **2.34°**, with **zero**
unloaded-patch frames, and the kerb peak to **3.27°**, also with zero unloaded
frames. Braking pitch falls from **1.82° to 1.32°**. The 350 mm dirt mound still
briefly unloads wheels, as expected for that large strike, and engages the
progressive bump stop at about 135 mm of spring travel.

The bus's springs already scaled with sprung mass. Passenger-car tyre stiffness
and the 48 kg unsprung cap made its requested roll stiffness infeasible; the
inverse series-stiffness calculation saturated at enormous anti-roll rates.
Most roll motion occurred through the tyres, bypassing the heavily damped corner
springs. A controlled release estimates only about 0.01 critical damping in that
roll mode. This is underdamping, rather than growing heave/integrator energy.
See `tools/bus-suspension-notes.md` for the physical calibration and test limits.

| Controlled bus result | Before | After |
| --- | ---: | ---: |
| Roll amplitude remaining at 2–2.5 s, relative to first 0.5 s | 79.51% | 0.42% |
| 0.3 g step lateral input, peak roll | 3.88° | 2.21° |
| 0.25 g lane change, peak roll | 1.91° | 1.26° |
| 80 mm kerb at 25 km/h, peak roll | 2.95° | 1.58° |
| 0.6 g brake input, peak pitch | 1.51° | 1.08° |

The physical fix keeps the bus CoM, mass and drivetrain. It gives commercial
vehicles appropriate wheel/axle mass and vertical tyres, softer feasible roll
stiffness, roll damping, bump/droop stops and a bound on coarse suspension steps.
The 220 kg scooter no longer assigns 120 kg to unsprung parts. BYD suspension
values remain unchanged. `unchanged-results.json` proves bit-identical full
vehicle state for all 62 unchanged specifications over 900 frames each.

## Files

- `controlled-*.png`: exported pitch/roll/heave plots for identical controlled
  inputs; `before-controlled.json` / `after-controlled.json` retain wheel loads,
  spring and tyre compression, and contact states at 60 Hz.
- `before/` and `after/`: the real game on Riviera, Low, 1280 × 800 browser viewport / 1024 × 640 native canvas captures. Each camera
  drives launch, 50/80 km/h cruise, braking, lane change, junction, kerb and bump.
  `telemetry.json` records 60 Hz body pose, spring compression, loads and contacts.
  The original full baseline uses the game's live day/night clock. The after
  run holds dry daylight; physical comparisons also use controlled tests and
  the matched kerb replay below.
- `matched-before/`: the original production Vehicle class and original bus spec
  installed into the same loaded Riviera game after the corrected run, with
  the same kerb, control sequence, dry daylight and chase camera.
- `bus-riviera-kerb-strip.webp`: inspected matched before/after chase strips at
  1, 3 and 6 seconds. `riviera-matched-kerb.png` is their full telemetry plot.
- Release photo: `assets/changelog/2026.10.15.3/bus-suspension.webp`, from
  `after/launch-2.png`, native 1024 × 640, lossy quality 75, 38,966 bytes.
- `stability-final.json`: every catalogue configuration, including both five-minute
  cruise cases. `preflight/` contains the six successful release-gate preflights.
- Complete JSON traces are gzip-compressed to save disk. Matched kerb source frames
  are stored as lossless WebP; other supporting photos use quality 90. The
  original release-photo PNG is retained.

## Reproduce in an isolated archive

Use the project's installed `node_modules` and Playwright (`PLAYWRIGHT_MODULE`
may override `/tmp/pw/node_modules/playwright/index.mjs`). Never run two browser
jobs at once. No production files or deployments are needed.

```sh
node --import ./tools/physics-test/register.mjs .scratch/bus-suspension/compare.mjs
node --import ./tools/physics-test/register.mjs .scratch/bus-suspension/unchanged.mjs
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
tools/browser-slot.sh node tools/bus-suspension-browser.mjs before
tools/browser-slot.sh node tools/bus-suspension-browser.mjs after
python3 .scratch/bus-suspension/build-evidence.py  # requires matplotlib and Pillow
```

The browser harness drives the real game's full frame step and Ground; physics
and scenery are not replaced with mocks. It injects deterministic driver inputs,
holds requestAnimationFrame for controlled stepping, then renders the normal
chase/cockpit views. Automatic tow is triggered through the actual corridor
policy, and its final four wheel loads are saved in each `report.json`.
