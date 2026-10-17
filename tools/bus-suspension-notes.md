# Commercial and assisted fleet suspension audit

The Citaro's springs already scaled with sprung mass. Its default passenger-car
vertical tyres (240 kN/m per corner) and 48 kg unsprung mass cap did not. Asking
that tyre compliance for 3.1 deg/g at a 12 t operating mass drove the inverse
series-stiffness anti-roll calculation near its ceiling: 2.229/2.169 MN/m bars.
Most roll deflection then occurred in the tyres, bypassing the spring dampers.
This was a lightly damped roll mode, not a mass-dependent spring-rate bug or
an unstable heave integrator. The previous flat-road gentle-corner tests bounded
peak roll but did not test decay after a disturbance or repeated uneven inputs. A 6 cm body release with 0.01 rad pitch / 0.02 rad
roll retained 79.5% of its roll amplitude after 2 seconds; the NPR retained 29.3%.
Kerb and steering inputs repeatedly excited it. The actual Riviera baseline
reached 8.63 degrees of roll during the junction turn, with a patch unloaded on
43 of 360 recorded frames, and 6.02 degrees on the roughly 80 mm kerb. Normal
50/80 km/h cruise was calm. This was reproduced in both chase and cockpit;
its suspension travel stayed small while the soft tyres allowed body roll.

The bus now has 200 kg effective unsprung mass per virtual corner, 1 MN/m tyres,
1.12/1.21 Hz front/rear sprung ride frequencies, mean damping ratio 0.45,
5 deg/g roll gradient, 130 mm bump / 160 mm droop travel, progressive stops,
and additional axle damping targeting 0.4 critical in roll. NPR and both Ducatos
use equivalent class-specific estimates. These are engineering calibrations,
not manufacturer-published air-spring or damper measurements. CoM, operating
mass, drivetrain and tyre friction remain their catalogue values.

The optional axle damper acts on differential suspension velocity and dissipates
energy. Its coefficient subtracts the damping already provided by the corner
dampers. Commercial profiles opt into a stiffness/mass-based maximum integration
step (including bump-stop stiffness); passenger-car force and substep arithmetic
are unchanged. Droop stops can carry tension when the wheel hangs at full extension.

Motorcycles and scooters are now traffic-only; the former player bike drivetrains and suspension cases have been removed.
The BYDs' existing mass-scaled spring/damper and tyre values pass the same audit.

`tools/physics-test/heavy-stability.mjs`, called by `regress.mjs`, covers every
selectable specification: 6 cm body release (each mode below 10% amplitude in the
2–2.5 s window), 0.3 g step lateral acceleration, 0.25 g lane change, an 80 mm
kerb at 25 km/h, 0.6 g braking, full Vehicle steering/lane-change/braking, and
five-minute periodic-road and powered cruise tests. Steering tests require all
four patches loaded and body roll below 8 degrees; braking pitch must stay below
8 degrees. Kerb strikes may unload a patch for at most 250 ms, then must settle and restore
at least 80% of static load by 5 s. Commercial profiles also run at a coarse
1/15 s caller timestep and a 2.5 m/s landing kick that engages the bump stops. Periodic cruise compares equal 10 s energy windows with
2% tolerance; powered smooth-road cruise allows 25% plus 0.02 J kinetic-energy
variation from the live gearbox and speed controller.

Evidence: `.scratch/bus-suspension/`. Controlled before/after traces retain pitch,
roll, heave, four compressions, loads and contacts. The Riviera browser harness
runs the actual game and Ground with deterministic controls, in chase and cockpit,
including launch, 50/80 km/h cruising, braking, a lane change, junction turn,
kerb, authored dirt bump and corridor-triggered auto tow. `unchanged-results.json`
compares 900 frames per unchanged specification against the original solver,
including every original enumerable Vehicle field (only the new cBar/susStep setup fields are excluded).
