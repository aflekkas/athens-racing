# Airborne physics: retained evidence

Already landed before this continuation: a1ecda8 (rigid body/impacts), 7b56a21 (multiplayer), ea077b3 (regressions), 6c68296 (traffic), d3fb671 (dissipative hull contacts).

The existing implementation has unilateral suspension, quaternion free flight, vertical/angular impacts and stopped side/roof tow after 2.5 seconds. Multiplayer interpolates 3D poses and authority accepts ballistic height while retaining horizontal teleport checks.

Controlled results from the retained implementation: crest 1.58 m / 1.33 s airborne; the production Ground._hit barrier at 150 km/h and 45 degrees launches and tumbles, then rests within 2.854 s of first touchdown. Hull contact energy does not increase. The bus reaches 90 degrees with a 12 cm kerb trip during an emergency swerve; the same 911 case reaches about 12 degrees and recovers. This is a tripped rollover: the stock bus slides before tipping on flat asphalt. Parked cars remain stationary without hopping.

These are historical controlled-scene browser captures, not a new named-map playthrough. Numerical scenarios and checks remain reproducible in tools/physics-test/airborne-scenarios.mjs, airborne.test.mjs, tools/airborne-network.test.mjs, and tools/physics-test/regress.mjs. Current clean-archive gates are recorded in the continuation report.

Retained contact sheets:

- [Crest](crest-sequence.webp)
- [150 km/h barrier](barrier-sequence.webp)
- [Bus rollover](bus-sequence.webp)

Intermediate frames, GIFs, raw traces and duplicate logs were removed. Original artifacts remain in Git history.
