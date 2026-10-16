# Handling feel: turn-in without more tyre grip

Baseline: `533c53bf28e594c35d041558edd45757b0c68c29` (prod archive). Deterministic 60 Hz commands, 240 Hz vehicle integration. Evidence is in `.scratch/handling/`; run `node --import ./tools/physics-test/register.mjs tools/physics-test/handling-audit.mjs output.json`. `PHYS` can select the saved baseline module when placed next to physics.js. No transmission, tyre coefficient, load sensitivity, differential, power or AI pace changes.

## What other games establish, and what is inference

* **Forza Horizon:** [Forza's FH5 setup guide](https://support.forza.net/hc/en-us/articles/4409761195923-FH5-Wheel-Setup-and-Tuning) explicitly describes multiple layers of Normal steering, disabled input layers for wheels, and an assist affecting yaw inertia during rapid reversals. This supports device-specific input filtering and stability help; it does **not** establish that Horizon secretly increases front friction or uses our exact slip-angle targeting algorithm. Its warning that stability can reduce agility matters: adding yaw damping indiscriminately can make the reported problem worse.
* **Gran Turismo:** [GT7's manual](https://www.gran-turismo.com/us/gt7/manual/drivingoption/03) distinguishes countersteering assistance, ASM and traction control. Countersteering helps recover the rear; it does not create front cornering capacity. GT's [1.31 physics/assist notice](https://us.gran-turismo.com/gb/gt7/news/00_1462138.html) also documents assist tuning alongside physics. Suitable here: mild, separately tunable recovery, released on deliberate drift entry. No public evidence cited here establishes GT's internal steering-to-slip algorithm.
* **NFS:** EA's [Show Up and Show Off developer article](https://forums.ea.com/discussions/need-for-speed-unbound-discussion-en/under-the-hood-show-up-and-show-off/9398276) describes selectable gas/brake tap drift entries and disabling them. Treat entry intent separately from ordinary grip cornering. For this game, retain explicit handbrake/flick and aids-off power-over; making every brake tap a drift would change the existing feel too much.
* **Assetto Corsa:** the original game exposes stability assistance alongside ABS/TC and controller speed sensitivity/filtering; those are distinct from a car's factory electronics. Public primary material accessed for this audit does not specify the original stability aid's force algorithm. Avoid presenting community descriptions of a “magic yaw torque” as a verified implementation. Kunos' [ACC physics notes](https://assettocorsa.gg/wp-content/uploads/ACCv19-physics_notes.pdf) concern a different title: they are a useful tyre/combined-slip contrast, not evidence of the original AC assist internals. A browser game should preserve the tyre model underneath an optional input helper.
* **Burnout / arcade:** [Criterion's own retrospective](https://www.ea.com/ea-studios/criterion-games/games) emphasizes speed, agile handling and drift. It supplies a design goal, not published tyre or yaw equations. Direct desired-yaw control, broad sliding grip plateaus and brake-to-rotate state machines are plausible arcade design tools, **recommendations/inferences here**, not reverse-engineered claims about Burnout.

## Techniques and suitability

| Technique | Benefit and cost | Keyboard/gamepad browser recommendation |
|---|---|---|
| Front-grip bias | Raises front saturation margin; too much erases FWD character and can produce snap oversteer | Last resort. Keep four-wheel load sensitivity and combined-slip budgets; do not add friction to conceal input overshoot. |
| Physical load sensitivity | Outside tyres gain less force than inside tyres lose; front roll stiffness therefore changes balance | Keep existing curve. A constant front multiplier is not a substitute for this physics. |
| Speed-sensitive steering ratio/lock | Prevents a short stick/key from requesting parking lock at 150 km/h | Keep rack envelope, but reserve enough angle for axle travel direction **plus peak slip**. A cap based only on speed/steady yaw kills entry response. |
| Virtual front slip targeting | Map input to useful slip relative to the front axle's velocity; compensate compliance | Best fit here. Already present for keyboard. Tighten the existing gamepad overshoot guard and slightly boost partial commands. Never cap drift countersteer as normal cornering. |
| Countersteer/yaw damping | Catches a rear slide; excessive damping fights flicks and throttle rotation | Keep existing countersteer and physical single-wheel ESC. Release with drift latch. No extra yaw damping needed from these measurements. |
| Lift-off/trail-brake rotation | Forward load transfer and rear engine braking tuck the nose in | Preserve actual load transfer/combined slip. Existing regression verifies trail braking rotates more than lifting. |
| Brake-to-rotate yaw assist | Makes tight turns easy on binary brakes, at the cost of a second handling mode | Optional future aid, gated by brake+steer+speed and drift intent. Do not inject it globally in this modest change. |
| Differential/AWD torque vectoring | FWD power consumes front lateral reserve; RWD power rotates rear; rear-biased AWD feels planted | Keep current axle split/LSD/EDL/TC. AWD moves rearward only after deliberate slide entry. A new yaw actuator would need its own power-on balance tests. |

Implemented input shape is `s * (1 + response * (1 - abs(s)))`, blended by the existing steering-assist strength. Response is opt-in per car: 0.10 on MINI, Carrera, M3, GTI and Superb 4x4, 0.18 on Huracán; default 0 for the rest of the fleet; maximum extra normalized command is 0.025 / 0.045. Zero and full input stay fixed. `steerSlipGuard` defaults to 1.02 peak angle (formerly 1.15); it remains disabled for assist-off, reverse, deliberate drift and slide-catching countersteer. The AI inverse uses the exact quadratic inverse, so its feed-forward still describes player physics. The guard also evaluates both front contact velocities: the outside front travels faster than the axle centre in a hairpin. Its release now requires genuine opposite-yaw countersteer; same-sign understeering sideslip no longer disables the guard. These parameters are per-car and can be zeroed/restored without changing tyres.

## Interpretation and real references

The current baseline already supplies ~0.93–1.13 g on the existing R40 skidpad. It does not support a blanket claim that all tyres are too slippery. Keyboard full request is already peak-targeted. Full gamepad request, however, repeatedly exceeds 1.15 normalized front slip. The remaining problem is chiefly access to the useful tyre force and short-input feel, not missing friction. In the slowest hairpin, centre-only targeting over-drives the outside front; same-sign understeering sideslip can also be incorrectly classified as countersteer, disabling the old guard.

Published instrumented benchmarks: [AWD Huracán 1.10 g](https://www.caranddriver.com/reviews/a33978640/2020-lamborghini-huracan-evo-rwd-drive/); [2012 911 Carrera 0.98 g](https://www.caranddriver.com/reviews/a15115521/2012-porsche-911-carrera-instrumented-test-review/); [E36 M3 0.87 g](https://www.caranddriver.com/features/a41889893/what-to-buy-1995-1999-bmw-m3/); [2018 GTI 0.89 g all-season / 0.95 g summer](https://www.caranddriver.com/reviews/a20917881/2018-volkswagen-golf-gti-manual-test-review/). These are context, not identical tyre/model-year validation. The simulated tyres are generally at least as capable, so no increase is justified.

[MotorTrend's 2003 Cooper S](https://www.motortrend.com/reviews/2003-mini-cooper-s-2-2) records 0.83 g and 66.8 mph through its 600-ft slalom. [Autoweek's same-era Cooper S](https://www.autoweek.com/news/a2097321/2003-mini-cooper-s-introduction-fresh-spring-new-mini-new-dealers-under-review-new/) records 46.9 mph on a tighter 490-ft slalom. That difference demonstrates why slalom speed is not a yaw-response time or transferable without cone spacing. Our MINI is another generation; neither number is an exact acceptance threshold. No comparable primary instrumented Superb 4x4 skidpad/slalom result was located. No invented sedan reference or slalom equivalence is used. Matched six-car physical slalom validation remains unavailable.

The measured gradient fits 0.1–0.5 g in the existing skidpad controller, including compliance; input shaping can slightly perturb the fit despite unchanged chassis coefficients. Fixed-speed capacity sweeps clamp longitudinal speed after each update to isolate lateral force (four inputs, last second of a four-second hold); these are not instrumented skidpad replicas. At 150 km/h this is lateral-capacity evidence, not a safe Megara entry speed.

Lap drivers use RivalAI's line and pedals, with binary steering error commands through actual Input for keyboard, continuous steering with 0.35 assist for gamepad. They test reproducible control, not human skill or a fully binary pedal driver. CPU laps retain actual geometry/grade/bank but deliberately omit barriers/loose surfaces; their wall count is not a collision validation. Browser laps separately enable production Ground and barriers. Tight-section runs cover six geometric peaks separated by 50 m at feasible 0.8-grip entry speeds, for all six cars and both devices. Minimum corner speeds are within ±10 m of each peak.

Time-to-peak yaw is the maximum over a three-second maneuver with natural speed evolution, **not** an isolated linear response constant. A maximum at 3.0 s is censored by the observation window. `yaw90` is time to 90% of the 1.0–1.5 s mean yaw. Raw traces retain both, so acceleration or late yaw growth cannot masquerade as latency.

## Before → after results

| Car | Gradient deg/g | R40 skidpad g | Fixed-speed max g, 60 / 100 / 150 km/h |
|---|---|---|---|
| huracan | 2.163 → 2.185 | 1.133 → 1.132 | 1.158 → 1.158 / 1.201 → 1.201 / 1.234 → 1.234 |
| carrera | 1.004 → 1.007 | 1.069 → 1.067 | 1.115 → 1.115 / 1.113 → 1.113 / 1.096 → 1.098 |
| e36_m3 | 2.440 → 2.467 | 0.961 → 0.973 | 0.986 → 0.986 / 1.001 → 1.001 / 1.016 → 1.016 |
| golf_gti | 2.738 → 2.779 | 0.928 → 0.965 | 0.989 → 0.989 / 1.000 → 1.000 / 1.014 → 1.014 |
| mini | 2.721 → 2.717 | 0.929 → 0.925 | 0.955 → 0.955 / 0.965 → 0.965 / 0.978 → 0.978 |
| superb_4x4 | 2.696 → 2.710 | 0.915 → 0.919 | 0.975 → 0.975 / 0.982 → 0.982 / 0.987 → 0.987 |

| Car/device | Yaw90 s | Peak yaw time s | Front >1.15 peak frames /180 | Lateral g at150ms |
|---|---|---|---|---|
| huracan / keyboard | 0.267 → 0.267 | 0.500 → 0.500 | 0 → 0 | 0.702 → 0.716 |
| huracan / gamepad | 0.233 → 0.217 | 3.000 → 0.483 | 173 → 0 | 0.790 → 0.806 |
| carrera / keyboard | 0.217 → 0.200 | 0.533 → 0.533 | 0 → 0 | 0.634 → 0.641 |
| carrera / gamepad | 0.183 → 0.200 | 0.500 → 0.517 | 172 → 0 | 0.718 → 0.730 |
| e36_m3 / keyboard | 0.233 → 0.233 | 0.500 → 0.483 | 0 → 0 | 0.668 → 0.672 |
| e36_m3 / gamepad | 0.200 → 0.200 | 0.467 → 0.467 | 171 → 0 | 0.700 → 0.712 |
| golf_gti / keyboard | 0.233 → 0.233 | 0.467 → 0.467 | 0 → 0 | 0.734 → 0.737 |
| golf_gti / gamepad | 0.217 → 0.200 | 2.850 → 0.433 | 172 → 0 | 0.761 → 0.774 |
| mini / keyboard | 0.217 → 0.217 | 0.450 → 0.450 | 0 → 0 | 0.729 → 0.733 |
| mini / gamepad | 0.200 → 0.183 | 0.433 → 0.433 | 172 → 0 | 0.760 → 0.774 |
| superb_4x4 / keyboard | 0.267 → 0.267 | 0.533 → 0.533 | 0 → 0 | 0.692 → 0.694 |
| superb_4x4 / gamepad | 0.250 → 0.233 | 0.500 → 0.500 | 171 → 0 | 0.704 → 0.718 |

Per-wheel angles can straddle exact peak (1.0); >1.15 identifies significant overshoot rather than claiming every wheel is always below peak. Exact >1.0 counts and all per-wheel samples are retained in before/after JSON.

| Huracán CPU dry lap | Time s | Off-road frames | Wall frames (disabled) | Lowest corner km/h |
|---|---|---|---|---|
| keyboard | 75.733 → 75.667 | 0 → 0 | n/a | 38.08 → 38.15 |
| gamepad | 75.067 → 75.100 | 0 → 0 | n/a | 38.15 → 38.13 |

Lap pace is essentially unchanged. Do not advertise this as a faster-lap or universal understeer cure. The measurable gain is removing full-stick front scrub and a modest improvement in early steering force.

| Tight section s / radius m | Keyboard minimum km/h | Gamepad minimum km/h |
|---|---|---|
| 1772.6 / 10.6 | 38.08 → 38.15 | 38.15 → 38.13 |
| 536.9 / 14.2 | 46.78 → 46.82 | 46.73 → 46.74 |
| 721.9 / 14.8 | 41.04 → 40.93 | 41.02 → 41.04 |
| 111.0 / 15.5 | 51.94 → 51.92 | 51.90 → 51.90 |
| 1646.7 / 15.5 | 45.90 → 46.05 | 46.04 → 45.95 |
| 712.9 / 17.0 | 41.04 → 40.93 | 41.02 → 41.04 |

| Six tight sections, sum of >1.15 front-slip frames /540 per device | Keyboard | Gamepad |
|---|---|---|
| huracan | 205 → 0 | 489 → 0 |
| carrera | 63 → 0 | 486 → 0 |
| e36_m3 | 58 → 0 | 480 → 0 |
| golf_gti | 121 → 0 | 481 → 0 |
| mini | 122 → 0 | 483 → 0 |
| superb_4x4 | 216 → 0 | 480 → 0 |

## Drift and validation contract

The existing broad drift grid retains >7 s handbrake and power-over holds for Huracán and E36 M3. Its five-second feint-hold criterion already fails at baseline: Huracán 1.7 s → 1.8 s, E36 M3 4.4 s → 4.4 s. This is disclosed, not hidden by changing a threshold. Feint still enters a slide; this patch does not claim to repair the pre-existing sustained-feint controller failure. `handling-audit.test.mjs` independently verifies a five-second AWD handbrake hold and RWD power-over hold with fixed controllers and no injected yaw. Existing driver-feel/maneuver tests retain aids-off power rotation, recovery and transitions.

No physics threshold was changed. The regular npm test imports the new six-car Megara/AI-inverse/drift contracts from driver-feel.test.mjs. Release gates and production-ground browser results are recorded alongside the evidence; all release gates must pass before prod ref publication.

## Production-Ground browser laps and evidence

Both builds also complete the real browser Ground/barrier path. These use the same scripted driver policy as the CPU laps, with the production surface/contact resolver. Screenshots are real WebGL chase-camera canvas frames at 0.2/0.4/0.6/0.8 s (DOM HUD omitted), inspected before reporting. Browser traces contain no page exceptions.

| Huracán, actual Ground | Lap s before → after | Off-road frames | Wall frames | Lowest corner km/h |
|---|---|---|---|---|
| keyboard | 75.650 → 75.767 | 0 → 0 | 0 → 0 | 38.09 → 38.14 |
| gamepad | 75.133 → 75.033 | 0 → 0 | 0 → 0 | 38.02 → 38.06 |

All per-corner minima and lap samples are in `laps-ground-before.json` / `laps-ground-after.json`; `summary.json` retains the scalar and corner tables without the full traces. The baseline was already capable of a clean scripted lap: the evidence supports a targeted reduction in scrub, not a claim that this modest patch transformed an unplayable baseline into a fast one.

## 2026-10-16: root cause of the "crazy understeer" and weak brakes

The follow-up in `.scratch/handling-opus/README.md` measured the remaining complaint. Grip and plain turn-in were
fine. The understeer came from the electronics and the assist whenever the driver braked, lifted or reversed at the
limit:
- ESC braking bypassed ABS and locked the outer front.
- The ABS limit ignored slip angle.
- A lifted S-bend latched "flick" drift mode: raw rack plus an automatic rear-brake dab.
- The assist cancelled front yaw damping.
- The ESC yaw reference collapsed as the assist trimmed the wheel angle.
- The friction ellipse added 10 % of braking grip on top of skidpad-calibrated grip.

`tools/physics-test/corner-entry.test.mjs` guards the 80 km/h corner entry and S-bend.
