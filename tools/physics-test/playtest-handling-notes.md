# Group-playtest handling correction (2026-10-14)

The checkout already fixed the old staging build's steering ramp, front-slip guard, cornering TC, per-wheel loose surfaces and burnout/launch model. No tyre coefficient, drive split, braking bias, brake force, ESC yaw term or road width was changed here.

The remaining reproduced defect was unrelated main-route curvature unloading a car moving across that route or on a flat neighbouring road. `suspensionRoadInput` now uses actual route progress speed on the main road, and three world-space contact-plane samples in the direction of velocity off the main road. Samples exclude kerb/hump steps, which remain inputs to the existing sprung/unsprung suspension. Normal gravity follows the rotated slope plane. Texture samples follow each wheel's actual route coordinate instead of assuming the car always faces along the route. Optional `route.contactFrame(s,u,out)` supplies physical axes/reset heading; `mapped: true` requests world-plane sampling even on asphalt. Ordinary main-road driving adds no Ground.at queries; side-road/off-road driving adds three per physics substep. Genuine crests can unload the tyres to zero; there is no imposed 15% support floor.

The existing springs, asymmetric bump/rebound dampers, tyre stiffness, bars and bump stops already drive physical Fz and visual heave/pitch/roll from the same integrated state. Their settings are retained. Tests check that pose matches suspension state and the combined-slip ellipse never exceeds the solved capacity.

## Read-only HUD API

`vehicle.tyreTelemetry` returns an immutable v1 snapshot. `front` and `rear` contain `loadN`, `utilization` (actual force ellipse, 0–1), `slipDemand` (unbounded, 1 = peak), `saturated`, `sliding`, and `contact`. Axle limits ignore wheels carrying less than 5% of axle load. `understeer` means the front axle is sliding with higher demand than the rear; it does not infer the driver's intended line.

`wheels` is ordered FL/FR/RL/RR and contains `loadN`, `capacityN`, `forceLongN`, `forceLatN`, `utilization`, `slipDemand`, `slipLong`, `slipLat`, `contact`, `driven`, `surface`, and `travelM`. Vehicle fields are `speedMps`, `steerRad`, `yawRateRad`, `sideslipRad`, `effectiveGravity`, `tcActive`, `absActive`, and `escActive`. Use slip demand for a saturation indicator: actual forces fall after breakaway. Snapshots allocate on demand; ordinary physics does not allocate HUD snapshots. No multiplayer telemetry is required.

## Repeatable evidence

Run `node --import ./tools/physics-test/register.mjs --test tools/physics-test/playtest-handling.test.mjs`.
Set `HANDLING_REPORT=path.json` to save measurements. `PHYS=file:///absolute/saved-physics.js` selects a baseline; `HANDLING_BASELINE=1` records all known failing unrelated-crest rows without stopping at the first load assertion. Three.js rendering is stubbed; Input, Vehicle, Route and Ground logic run unchanged. Ground fixtures contain no walls/kerbs and their sampled dirt is labelled grass to exercise the shipped grass tyre curve. The recovery fixture starts 0.30 m below the road on a 10% incline at elevation 10 m (above sea level).

MINI/Golf/Corolla/Z4 are tested with actual keyboard W+D at an initial 30 km/h, aids on/off and manual/automatic policy. These are natural-speed runs, not speed-clamped turns. Current TC-on FWD final yaw radii are 7.5–7.75 m; TC-off MINI/Golf spin the front tyres and widen the line without a drift latch, while the RWD control develops power oversteer. There was no remaining low-speed refusal to fix in this checkout.

Before/after unrelated-crest loads are 0.367–0.376 mg / 1.0001–1.0011 mg across all four cars, both cross-road and flat side-road fixtures. All cars already recover from the grass incline before the correction and still recover after it. Rough-road loads remain 0.710–1.277 mg with 21.5–24.9 mm body heave. MINI/Golf/Corolla skidpad limits change by under 0.02 g; Z4 changes 1.081→1.028 g because heading-correct texture changes which wheel receives a bump at the threshold. Brake yaw gain remains 1.19–1.33 vs lift 1.02–1.06: the liked braking rotation is retained. 60/120/240 Hz grouping of the same actual-controller transient agrees within 1e-6 in position, velocity, yaw and loads.

The strongest shipped Penteli profile crest is about -0.00250/m, only ~7% static unloading at 60 km/h. CPU route checks cover s=2269, 6617 and 6707; they do not reproduce the playtest's unknown launch/fallthrough coordinate. Roads owner reports the fork at s=5744 was already corrected by 359964f. World owner independently investigates terrain bilinear-versus-triangle contact, outside this patch.

The frozen automatic trajectory is intentionally regenerated for heading-correct wheel texture. First position change is 0.000020 m at frame 59. The later uncontrolled TC-off RWD replay diverges by 55.8 m at frame 899, so the baseline update is explicitly a handling change. Engine owner separately proved current vs engine-hooks-stripped automatic MINI/Z4/taxi bit-identical over 900 frames with handling retained.

## Research and limits

[VDrift car parameters](https://github.com/VDrift/vdrift/blob/master/docs/Car_parameters.md) describes per-wheel coilover stiffness, separate bounce/rebound damping, travel and anti-roll forces. Its [suspension source](https://github.com/VDrift/vdrift/blob/master/src/physics/carsuspension.cpp) is primary open-source reference material. [BeamNG bounded beams](https://documentation.beamng.com/modding/vehicle/sections/beams/bounded/) documents distinct bump/rebound and velocity-dependent damping plus progressive stops. These support retaining the existing physical corner suspension and testing forces/pose together. No source code was copied; BeamNG is not treated as open source. This correction uses elementary contact-plane/normal acceleration mechanics, not a BeamNG engine port.

Clean candidate archive passes 19/19 focused/manual/barrier checks and 108/108 catalogue/dynamics regressions. Working-checkout driver-feel checks pass 8/8 and MINI suspension checks 21/21. Additional mapped-reset and main-road normal tests pass.

Real browser evidence is incomplete: T3 preview snapshot timed out twice with `Preview automation snapshot timed out after 15000ms.` The single FIFO fallback acquired a slot after 149 s but full game boot timed out at 60 s. Its browser was closed in finally. CPU fixtures do not establish subjective feel, rendered suspension appearance, real-world fidelity or the unknown Penteli playtest coordinate. No deploy/push was performed.
