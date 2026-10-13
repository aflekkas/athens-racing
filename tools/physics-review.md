# Physics review: `src/physics.js`

Scope: vehicle dynamics audit and rewrite of the tyre/driveline core, plus crash damage. The off-road/ground hooks
(`this.ground`, `surfMu`, `surfDrag`, `gradeG`) belong to the map session. Handbrake declutch, gear hold, drift latch,
`slideV` and `muX` belong to the drift-tuning session.

## Running the tests

```
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs   # regression, exit code 1 on failure
node --import ./tools/physics-test/register.mjs tools/physics-test/bench.mjs      # per-car numbers (drift session)
PHYS=../../path/to/other-physics.js ...                                           # test another physics module
```

`register.mjs` and `hooks.mjs` swap `three` for a tiny stub, and `./road.js` (imported by physics.js) for a stub
with `ROAD.limits`. So the real module runs under Node 22 with no dependencies. The route is a flat, endless
straight. The handling tests use one **controlled chassis** (50/50, 250 kW, open diff, assists off) and change only
`spec.drive` (plus `lsd` / `edl` where stated). Any FWD/RWD difference therefore comes from where the torque goes.

## Bugs found in the original

| # | Bug | Effect |
|---|-----|--------|
| 1 | Lateral load transfer was **half** the correct value. Each wheel got `Fz/2 ± dL/2` with `dL = m·ay·h/t·rsF`, but the moment balance `(Fl − Fr)·t/2 = m·ay·h` needs `Fl − Fr = 2·m·ay·h/t`. | Load sensitivity and roll-stiffness balance (`rsF`) had only half their effect. That's the main reason inside-wheel unloading, and so open-diff wheelspin, was weak. |
| 2 | The open diff wasn't actually a diff. The axle's drive capacity `2·min(cl, cr)` only rescaled the slip (`sx *= cap/capX`), and peak axle Fx stayed at the full `cl + cr`. | No inside-wheel spin. FWD and RWD differed only through the friction circle on the whole axle. |
| 3 | Two-wheel (bicycle) model: no track width in the tyre kinematics, and no left/right Fx moments. | No yaw from unequal drive (LSD locking, single-wheel ESC braking). Yaw damping from track width was missing. |
| 4 | ESC and the side-slip limiter injected a raw yaw moment `Mz` (gain `Iz·14` / `Iz·30`) with no matching tyre force. | A yaw torque from nowhere: it didn't slow the car and wasn't limited by grip. |
| 5 | Engine braking `Teb` always had the forward sign. | A car rolling backwards in a forward gear was *accelerated* backwards. |
| 6 | TC, ABS and the wheelspin/lock-up readouts tested `sx > 1.6` / `sx < −1.15` with signs fixed for forward travel. | In reverse at full pedal the driven wheels spun to −60 km/h unchecked. A FWD car then spun (trailing axle with no lateral grip), and the reverse cap overshot to 31 km/h. |
| 7 | Reverse cap was a hard `Tnet = 0` when `vx < −7`. | Spinning wheels plus engine inertia overshot the cap. |
| 8 | Reverse was selected at `vx < 0.5` with the brake held, i.e. while still rolling forward. | Brief backward drive before the car had stopped. |
| 9 | Wheelbase and size came from `spec.body` (`'z4'` and `'octavia'` fell to the 2.55 m default). `spec.wheelbase/length/width` were ignored. | Wrong yaw inertia, load transfer and collision extents for the new cars. |
| 10 | `engine: 'turbo6'` (Z4) wasn't in `ENGINES`. | The Z4 silently used the turbo4 curve. |
| 11 | `POWER_MUL = 1.3`. | Catalogue power was inflated by 30%. It's now 1, overridable with `spec.powerMul`. |
| 12 | Low-speed kinematic blend, ESC gating and `lockAt` used `|vLong|`. | A car 70–80° sideways (vLong ≈ 0) was snapped to kinematic yaw. All three now use total speed. |

Honest note: on the controlled chassis, the **original** code already showed FWD understeer and RWD oversteer under
power (the friction-circle effect on the driven axle was there). What it lacked was the open-diff and LSD behaviour,
correct load transfer, physical ESC and the reverse fixes. The original passes 31/47 of the regression tests. Its
failures: inner-wheel spin, LSD, EDL, the RWD lift-off rotation comparison, reverse yaw snap, the reverse speed cap,
RWD time-step convergence (0.17 rad yaw spread across frame rates) and damage (missing).

## Model now

- **Loads per wheel:** longitudinal `ΔFz = m·ax·h/L`; lateral `ΔFz_side = m·ay·h/t`, split by `rsF`, clamped so a
  lifted wheel carries 0 and its axle mate carries the axle load. Both use the spring-filtered accelerations, as before.
- **Tyres per wheel:** the same normalised combined-slip (similarity) curve, with `sN = |(κ/κpk, tanα/tanαpk)|` and
  load sensitivity `μ(Fz) = μ0(1 − ls(Fz/Fz0 − 1))`. Each wheel has its own contact velocity
  `(vx − r·y, vy + r·x)`, its own slip angle with relaxation length, and its own spin state.
- **Driveline, per axle, implicit Euler**, with the tyre linearised at its steepest slope (unconditionally stable for
  the stiff wheel modes):
  - `(mw + dt·kx_i)·Δv_i = dt·(Fd/2 ± Lk/2 + G_i)` gives equal torque to each side (open diff).
  - `Fd = Feng − Jeq·(ΔvL + ΔvR)/(2dt)`, where `Jeq = Je·(i/R)²` is the engine inertia on the carrier while the clutch is locked.
  - LSD: `Lk` is the force that would equalise the two sides, clamped to `lsd·|Fd|` (a Coulomb clutch / torque-bias
    coefficient: `lsd = (TBR − 1)/(TBR + 1)`). It is solved exactly, because the system is linear in `Lk`.
  - Brakes are Coulomb friction: they stop a wheel but never reverse it.
  - FWD, RWD and AWD differ **only** in which axle gets `Feng` and `Jeq`. There are no drivetrain-labelled yaw terms.
- **EDL** (open-diff cars, `spec.edl`, defaulting to the TC strength): brakes the wheel spinning faster than its
  partner. Through the open diff that hands torque to the gripping side (Mini/Octavia XDS-style).
- **ESC** works by braking a single wheel, the outer front against oversteer. The demand comes from the old yaw-rate
  and side-slip laws, converted with `F = Mz/(t/2)` and applied one substep later through the tyre. It therefore also
  slows the car and is limited by grip.
- **Diff defaults:** turbo4/diesel use an open diff (`lsd: 0`, plus EDL); turbo6 uses `lsd: 0.3` (Z4 M Sport
  differential). `spec.lsd` overrides.

## Damage (`addDamage(zone, dv, e)`)

`zone` is front/rear/left/right. Traffic supplies closing speed as `e.sev` and impulse delta-v as `dv`.
When `e.sev` is present, energy uses that closing speed, with `dv > 0` as an impulse gate; otherwise walls and
legacy callers supply closing speed directly as `dv`. Separating or impulse-free contact does nothing.
In the formulas below, `dv` means closing speed. The crush energy becomes an equivalent barrier speed (EBS):

- Rigid object (no `e.car`, or `kind: 'wall'`): `EBS = dv`.
- Car of mass `m2`: `E = ½·μ·dv²` with `μ = m1·m2/(m1 + m2)`, shared by stiffness. Equal cars take half each; a
  lorry or bus (m2 > 3 t) is stiffer, so this car takes ¾. Then `EBS = dv·√(share·μ/m1)`. Equal masses give
  `EBS = dv/2`, the textbook result.
- Damage increment = `(EBS − 2.2)/(V_full − 2.2)`, clamped to 0..1. Below 8 km/h the bumper absorbs it.
  `V_full` is 15 m/s (54 km/h) front/rear and 9 m/s side (doors and sills have less crush space). Damage
  accumulates, and `reset()` clears it.
- Effects (`damageFx()`):
  - `engHealth = 1 − 0.3·smoothstep(0.35, 1, front)` multiplies engine torque.
  - `toePull = 0.006·(right − left)` rad is a steer offset (about 12 m of drift in 5 s at 90 km/h hands-off when the
    side is badly damaged).
  - Drag rises by up to 6%.
  - `smoke` latches once `front ≥ 0.6`.
- `lastDamage = {zone, inc, ebs, kind}` is set for the HUD/audio. The method returns `inc`. It is fully deterministic.

## API

Unchanged: `wheel[0]` and `wheel[1]` are now **axle summaries** (`vw` = mean wheel speed for mesh rotation, `sx`,
`sy`, `Fx`, `Fy`, `Fz`, `abs`). New: `corners[FL, FR, RL, RR]` with per-wheel `vw`, `sx`, `sy`, `Fz`, `Fx`, `Fy`,
`aDyn`, `abs`, `esc`, `edl`, for per-wheel mesh spin or tyre smoke. Also new: `damage`, `smoke`, `engHealth`,
`toePull`, `lastDamage`, `addDamage()`, `damageFx()`. `syncWheels()` restores each corner to its rolling speed
after an impulse, accounting for yaw rate and steering so the next substep does not introduce artificial slip.

## Results (catalogue cars, flat road, current tuning by the drift session)

| car | 0–100 | top | 100–0 |
|-----|------:|----:|------:|
| Mini Cooper S (FWD) | 7.02 s | 226 / 230 | 36.9 m |
| Z4 M40i (RWD)       | 4.87 s | 248 / 250 | 32.3 m |
| Octavia 2.0 TDI (FWD) | 8.40 s | 221 / 227 | 39.3 m |

The second Opus review adds traffic-event damage and impact wheel-sync coverage: 50 regressions pass.

## Limitations

- **The implicit wheel solve linearises with the steepest (zero-slip) tyre slope even past the peak.** Found by an
  external review relayed by the drift session. The update `Δv = dt·(F − F0)/(mw + dt·kx0)` stays stable, and its
  fixed points are exact (steady-state slip is right, because Δv = 0 ⇔ net force = 0). But past the peak the true
  local slope is about 0 or negative, so the effective wheel inertia is overstated. During breakaway the wheels spin
  up (or lock) more slowly than they should: the review measured 8.4 kN net force against 3.3 kN effective at a TC-off
  launch. That softens wheelspin and lock-up transients, and is part of why ABS/TC look calm. Fix to try separately
  and validate: per substep, a Newton or secant iteration on `mw·(v′ − v) = dt·(Fd − Fx(v′) − Fb)` using the actual
  slope `max(ε, dFx/dv)` with a step limit. Accept it only if the time-step convergence test still holds. Don't just
  drop `kx` from the denominator, which is unstable at 240 Hz (dt·kx/mw ≈ 13 near zero slip).
- Since this audit, the drift session removed the `vt > 0.5` gate on the handbrake (it now holds the car at rest, via
  the Coulomb brake path) and changed tyre relaxation to use patch speed `hypot(vgx, vgy)`. Regression stays 47/47.
- Parallel steer (no Ackermann). At parking speed the kinematic blend sets yaw anyway.
- Tyre cornering stiffness scales with peak force (similarity method). Real stiffness saturates with load faster.
- ESC acts one 240 Hz substep late. There is no understeer intervention (inner-rear braking).
- AWD keeps a fixed torque split (no centre-diff dynamics). None of the three cars is AWD.
- Roll-stiffness split and roll-centre effects are lumped into `rsF`. There is a single track width for both axles.
- Brakes are split equally left/right before ABS/ESC. The Coulomb stop uses each wheel's own effective inertia.
- Damage stiffness shares (½ and ¾) and V_full are representative values, not per-model crash data. Restitution
  isn't subtracted from the crush energy (≤ 5% for e ≈ 0.2).
