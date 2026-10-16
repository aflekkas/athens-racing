# Handling and braking: root cause and fix

Owner report: "understeer and braking is weak! I am going into a corner at 80 in a Lambo, I should be able to go sharp
into it and keep traction". Baseline is `prod` before this commit (deterministic 60 Hz commands, 240 Hz physics,
flat test road unless stated). Reproduce with `node --import ./tools/physics-test/register.mjs .scratch/handling-opus/bench.mjs`
(`PHYS=…/physics-before.js CARSFILE=…/cars-before.js` for the baseline). The Megara laps use
`tools/physics-test/handling-opus-evidence.mjs laps out.json`, and the frame strips use `tools/physics-test/handling-opus-browser.mjs`.

## What was actually wrong

Steady-state grip was never the problem. The baseline skidpad was already at or above the real figures (Huracán 1.13 g;
C&D measured 1.10 g). Plain step-steer turn-in was already quick: 0.31 rad/s at 150 ms on keyboard and 90 % of yaw in
0.2 s. Straight-line braking was *shorter* than the real figures (Huracán 30.3 m, Z4 31.7 m). The understeer and "weak
brakes" come from the electronics and the steering assist. They ran the tyres far past their peak **whenever the
driver braked, lifted or reversed the steering at the limit**, and that is how anyone drives into a corner.

| # | Formula / code | Bug | Effect |
|---|---|---|---|
| 1 | `Fb = brk·abs + … + esc` | ESC's single-wheel brake force was added *outside* the ABS factor. | Trail-braking at 80 km/h made ESC brake the already-braked outer front. ABS could not release it, so it **locked** (slip ratio −5.5× peak). The most loaded front tyre lost its side force, and the 911 at brake 0.4 went from yaw 0.73 rad/s to 0 (path radius 15 km, i.e. straight on). |
| 2 | ABS release at `sx < −1.15` | The ABS limit was longitudinal-only and ignored the slip angle. | A braked, steered front sat at combined slip `hypot(1.15, 1.0) ≈ 1.5`, past the friction-circle peak. Both components fall there and the force swings rearwards. Full brake + full steer gave only 0.52–0.66 g of cornering. |
| 3 | ABS floor `max(0.35, …)`, bang-bang ±9/4 s⁻¹ | A light inner wheel locked even at 35 % pressure, and the cycle swung slip between 0.4× and 1.5× peak. | Inner rear lock-ups in braked bends (Z4 RR slip −2.4) produced snap oversteer, which ESC then caught by ploughing. |
| 4 | flick detector `|sIn|>0.5 reversal, thr<0.3, |ay|>4` → `driftLatch = 1`, plus automatic rear "dab" | Every lifted S-bend reversal at more than 0.41 g counted as a Scandinavian flick. The latch switched the keyboard steering assist to the **raw rack**, and `flickDab` dragged the rear brakes automatically. | The fronts went to 1.7–1.9× peak slip (plough), then the rear-brake drag spun the car. Every sports car spun in a plain 80 km/h S-bend: 44–81° of sideslip. |
| 5 | assist target `δ = thF + αpk`, with `thF = atan((vy + a·w)/vx)` | Tracking the front axle's travel direction includes `a·w/v`, which cancels the front axle's natural yaw damping. | A step input overshot the grip-limited yaw rate by ~50 %, and the S-bend pendulum swung the tail out. |
| 6 | ESC reference `wDes = vx·tan(δ)/L` | δ is the assist's own output, which it trims as the car rotates, so the reference collapsed exactly when the car turned. | ESC braked the outer front of cars that were only using the grip they had been asked for. Z4 lift-off rotation fell from 0.67 to 0.43 rad/s, below the steady value of 0.52, and the line ran wide. |
| 7 | `muX = 1.1` on top of `grip` | The longitudinal peak was 10 % above lateral, and `grip` was already calibrated to the instrumented skidpad. | Huracán μx 1.36. Braking was 15 % above cornering (real: 5–8 %). 100–0 in 30.3 m with a 1.46 g peak, versus a real 31–34 m. |
| 8 | pedal gain 1.15 | Half pedal gave about 0.75 g on a 911 and ABS-limited in the wet. | The "weak brakes" report on partial trigger/keyboard ramp. |
| 9 | bus `grip 0.98`, `bias 0.72` | Car-like tyre grip; a 72 % front brake bias on a 35 %-front-weight bus (ideal ≈ 45 %). | The bus cornered at 0.78 g, and its fronts locked before the rears worked. |

Checked and not at fault: the tyre curve itself (Pacejka similarity, sin(C·atan(B·s)), peak at the normalised slip
`tan α / tan αpk`), load sensitivity, lateral/longitudinal load transfer (roll-stiffness split, CoG height, track,
wheelbase), the rad/deg and km/h↔m/s conversions, the per-wheel vs per-axle force split, the 240 Hz integration
(30–240 Hz agree in regress), the rack ratio/lock (0.29 rad at 80 km/h for the Huracán, three times the peak slip
angle) and the keyboard ramp (full lock in 0.17 s).

## Fixes (src/physics.js, src/cars.js)

1. ESC brake force goes through the ABS modulator, and ABS also runs for ESC-only braking.
2. Combined-slip ABS limit: fronts `max(0.65, √(1.15² − sy²))`, so a turning front keeps both side force and braking.
   Rears `max(0.15, √(1.1² − sy²))`, kept below their combined peak (cornering brake control / EBD). Straight-line
   braking is unchanged at 1.15.
3. ABS is a slip regulator (integral action, gain 80 s⁻¹, floor 2 %) targeting the peak instead of a 35 %-floor bang-bang.
4. The flick needs a brake or handbrake dab, and so does the automatic rear-drag dab. A drift latch hands over the raw
   rack only once the car is actually sliding (|β| > 4–9°) or on a handbrake turn.
5. The assist stops chasing yaw beyond the grip-limited yaw rate `ayCap/v`, which restores yaw damping at and above the
   limit only. Below the limit, turn-in is unchanged and stays sharp. This is off during a deliberate drift.
6. The ESC reference is the driver's request: with the assist, full input means "turn at the limit", capped at the car's
   own steady lateral capacity. ESC no longer cuts engine torque against oversteer on front-drive cars, because that is
   a lift-off.
7. `muX` 1.1 → 1.04, pedal gain 1.15 → 1.3, AI brake model ABS factor 0.94 → 0.95.
8. Bus: grip 0.67, bias 0.50, brake 0.9.
9. AI (`src/rival-ai.js`): the existing "ease the brake when the rear slips" guard now works from 3 m/s (was 6 m/s).
   With the stronger pedal, a rival Z4 trail-braking a Psychiko street corner at 18 km/h otherwise slid 12° and
   brushed the kerb.

The AI uses the same physics, and its capability API (`maxBrakeDecel`, `maxLatAccel`) reads the same constants. Its
straight-line brake model stays conservative: Z4 1.161 g modelled vs 1.180 g simulated.

## Before → after

| Car | Skidpad g | 100–0 m | Peak decel g | Yaw @150 ms kbd rad/s | Yaw @150 ms pad | 80 km/h + brake 0.4: R at 1 s (m) | Full brake+steer: lat g / decel g | Lifted S-bend max sideslip |
|---|---|---|---|---|---|---|---|---|
| huracan | 1.13 → 1.12 | 30.3 → 30.4 | 1.46 → 1.40 | 0.313 → 0.314 | 0.402 → 0.402 | 24 → 32 | 0.65/1.06 → 0.93/0.85 | 67° (drift latched, spun) → 4° |
| aventador_svj | 1.14 → 1.14 | 29.2 → 29.4 | 1.44 → 1.41 | 0.318 → 0.318 | 0.427 → 0.427 | 37 → 29 | 0.66/1.09 → 0.94/0.88 | 66° (drift latched, spun) → 4° |
| z4 | 1.04 → 1.04 | 31.7 → 32.7 | 1.33 → 1.28 | 0.314 → 0.314 | 0.416 → 0.416 | 187 → 34 | 0.59/0.97 → 0.85/0.77 | 59° (drift latched, spun) → 4° |
| carrera | 1.07 → 1.07 | 32.0 → 32.9 | 1.32 → 1.26 | 0.359 → 0.359 | 0.460 → 0.460 | straight on → 39 | 0.63/0.96 → 0.84/0.76 | 81° (drift latched, spun) → 8° |
| e36_m3 | 0.97 → 0.96 | 33.3 → 34.5 | 1.26 → 1.20 | 0.320 → 0.320 | 0.393 → 0.393 | 44 → 37 | 0.54/0.93 → 0.77/0.75 | 62° (drift latched, spun) → 5° |
| golf_gti | 0.97 → 0.91* | 35.0 → 35.5 | 1.20 → 1.16 | 0.321 → 0.321 | 0.393 → 0.393 | 96 → 36 | 0.52/0.89 → 0.77/0.71 | 52° (drift latched, spun) → 5° |
| mini | 0.92 → 0.92 | 36.6 → 37.3 | 1.15 → 1.11 | 0.324 → 0.324 | 0.402 → 0.402 | 157 → 40 | 0.51/0.83 → 0.75/0.67 | 54° (drift latched, spun) → 5° |
| bus | 0.78 → 0.60 | 52.3 → 55.4 | 0.83 → 0.75 | 0.135 → 0.095 | 0.171 → 0.120 | 37 → 50 | 0.45/0.64 → 0.38/0.53 | 44° → 6° |

\* The R40 skidpad harness loses the GTI's circle at a gear change. At R30 and R60 it reads the same as before (0.937 /
0.921 g), and fixed-speed lateral at 80 km/h is 1.01 → 1.00 g.

Real references: Huracán EVO 100–0 ≈ 31.9 m (Lamborghini), C&D 70–0 mph 140 ft; Z4 M40i 33–35 m; 991 Carrera
≈ 34 m; skidpad 1.0–1.1 g on road tyres. The Lambos stop 1–2 % short of "about 31" and the Z4 ~1 % short of 33. The
binding constraint is the existing Corolla check (dry 100–0 < 40 m), now at 39.7 m. Yaw at 150 ms is unchanged because
it was already quick. The fix is in what happens next: the car keeps rotating and holds its curvature instead of
being braked straight by ESC, locked by ABS or spun by the drift latch.

**80 km/h corner-entry regression** (`tools/physics-test/corner-entry.test.mjs`, new, in `npm test`): Huracán, SVJ, Z4,
911 and M3; keyboard (real Input ramp) and gamepad; lifted, brake 0.3 and full brake; plus the lifted S-bend. The
baseline passes 14/40. After the fix it passes 40/40.

**Megara, perfect RivalAI line and pedals, steering through the real keyboard chain / gamepad stick.** CPU dry
continuation with actual grade and bank:

| Car / device | Lap s | Off-road frames | Max sideslip ° | Lowest corner km/h | Corner minima (R10.6 / R14.2 / R14.8 / R15.5 / R15.5 / R17.0 m) |
|---|---|---|---|---|---|
| huracan / keyboard | 75.67 → 76.17 | 0 → 0 | 3.4 → 3.4 | 38.2 → 38.1 | 38/47/41/52/46/41 → 38/47/41/52/46/41 |
| huracan / gamepad | 75.10 → 75.50 | 0 → 0 | 3.4 → 3.4 | 38.1 → 38.0 | 38/47/41/52/46/41 → 38/47/41/52/46/41 |
| aventador_svj / keyboard | 76.33 → 76.58 | 0 → 0 | 1.9 → 1.8 | 38.9 → 38.8 | 39/48/40/53/44/40 → 39/47/39/53/44/39 |
| aventador_svj / gamepad | 76.00 → 76.22 | 0 → 0 | 1.8 → 1.8 | 38.8 → 38.8 | 39/48/39/53/44/39 → 39/47/39/53/44/39 |
| z4 / keyboard | 81.87 → 82.52 | 0 → 0 | 3.9 → 3.8 | 36.5 → 36.4 | 37/45/44/50/51/44 → 36/45/44/50/51/44 |
| z4 / gamepad | 81.58 → 82.20 | 0 → 0 | 3.8 → 3.8 | 36.5 → 36.4 | 37/45/44/50/51/44 → 36/45/44/50/50/44 |
| carrera / keyboard | 83.02 → 83.33 | 0 → 0 | 2.4 → 2.5 | 36.3 → 35.7 | 36/45/41/49/47/41 → 36/45/41/49/47/41 |
| carrera / gamepad | 82.35 → 82.72 | 0 → 0 | 2.5 → 2.6 | 36.3 → 35.7 | 36/45/41/50/47/41 → 36/45/41/49/47/41 |
| e36_m3 / keyboard | 86.28 → 86.97 | 0 → 0 | 4.5 → 4.4 | 34.6 → 34.2 | 35/43/42/47/48/42 → 34/42/42/47/48/42 |
| e36_m3 / gamepad | 86.23 → 86.68 | 0 → 0 | 4.6 → 4.8 | 34.5 → 33.9 | 35/43/42/47/48/42 → 34/42/42/47/48/42 |

The AI lap never overdrives the tyres, so it cannot show the bugs above: its corner speeds are unchanged. It is
0.2–0.7 s slower because the AI now plans with the realistic (longer) braking.

**Browser, production Ground, chase camera.** The frame strips are real WebGL frames, eight per run:

* `sbend-huracan-before.webp` / `-after.webp`: lifted keyboard S-bend at 80 km/h. Before: drift latch, 65° spin.
  After: no latch, 9° peak sideslip.
* `hairpin-{huracan,z4,carrera}-{before,after}.webp`: overcooked Megara hairpin (R 10.6 m). The car coasts in at
  80 km/h, brakes 30 m out and trail-brakes in. No car left the road in either phase. Minimum speed in the hairpin:
  Huracán 31.2 → 33.7 km/h, 911 30.6 → 35.7 km/h, Z4 28.0 → 27.7 km/h. Z4 ESC frames: 25 → 4.

**Drift** (`drift-grid.txt`; criterion: hold 0.3–0.6 rad for 5 s):

* Handbrake, power-over and transitions pass as before. The SVJ power-over fails in both phases (0 s before, 1.6 s
  after).
* The lift-only feint deliberately no longer latches, because it is indistinguishable from an S-bend. The flick is now
  lift + reverse + brake dab. Z4, 911, M3 and GTI hold it 6–7 s. The Huracán holds it 4.3 s (the prior notes give
  1.7 s for its lift-only feint).
* The keyboard slalom at 100 km/h now peaks at 4–7° of sideslip (was 12–17°).

## Gates and test changes

* `regress.mjs` 1,141/1,141 and the physics group (219 tests, including rivals and traffic races) pass. Recovery
  passes 46/46. No regress threshold was changed. Gates were run on a clean `git archive prod` copy: `npm test`,
  regress (1,142), events, ghost-lap, check-syntax, check-browser-imports and the wrangler staging dry run.
* `.scratch/pov-camera/mask-source-hashes.json`: only the `src/cars.js` hash changed (bus brake/grip data). The
  re-run mask capture gave identical windscreen percentages for all 70 configurations, so the images were not
  replaced.
* `auto-input-baseline.json` was regenerated (the frozen automatic trajectory moves with any physics change).
* `maneuvers.mjs`: the MINI aids-on handbrake 360° gets 9.5 s instead of 9 s. With the friction ellipse at 4 %, its
  front-drive crawl after the slide is ~0.3 s slower (357.5° at 9 s).
* `drift.mjs`: the feint entry includes the brake dab.
* Sand rut fill 0.35 → 0.4 /s: the Z4 wet deep-sand rut sat at 0.017 after the 2 s lift.
