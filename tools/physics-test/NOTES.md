## 2026-10-14: deliberate spins, broad drifts and recovery

The live TC/ESC toggle preserves gearbox/chassis state. Enabling it resumes intervention after a power slide, while a recorded ongoing handbrake turn retains its deliberate-spin exception; only policy fields change, never yaw/velocity/gear.

The additional player reports revise the old drift-mode policy. Normal aided RWD power slides keep their existing bounded rotation. Deliberate handbrake/feint slides yield TC, EDL, ESC and automatic steering mapping until the car actually aligns; switching TC/ESC off never silently restores TC.

Confirmed causes:

- `tcK = lerp(spec.tc, 0.5, driftLatch)` restored TC even when `spec.tc` was zero. The before 911 donut trace reaches a 94.4% throttle cut with the controls set off.
- The parking blend directly overwrote yaw rate and lateral velocity from CG translation speed. A powered pivot can have slow CG translation and fast tyre/yaw motion. That projection stopped rotation and changed the velocity during slow recovery. The separate rest hold also requires quiet yaw, so it cannot pin free rolling wheels during a coasting pivot. It is removed; all yaw increments integrate the actual contact-patch moments. A dedicated one-substep Newton/Euler check covers a slow turning handbrake pivot.
- Drift intent used folded sideslip (`abs(vLong)`) and CG speed, and its persistence required a driven rear axle or countersteer. It could release during backwards travel or a coasting FWD spin. Intent now uses the actual direction of travel and rotational contact motion, and remains set while an explicitly initiated slide is still underway.
- Latched ESC retained 5% strength, steering retained half its peak-angle mapping and 40% of its countersteer helper, and fitted TC/EDL still constrained an intentional spin. They now yield throughout the deliberate slide; explicit steering-assist Off also disables the countersteer helper. Ordinary unlatched moderate slides retain their existing aids.
- The sliding-friction branch used `vLong > 0` to choose the lateral curve. Passing through sideways/backwards motion changed friction abruptly. Lateral versus longitudinal force sharing now follows wheel slip direction in both directions. Slip angle and slip ratio also use the same 3 m/s low-speed reference.
- A slow turning W+handbrake input could be classified as a straight brake stand and apply the RWD front line-lock. Brake stands now require near-straight steering and low yaw; the normal turning handbrake acts on the rear.

No synthetic yaw torque, yaw-rate cap, sideslip clamp, extra grip or chassis/spec retune was added. The existing broad lateral plateau is retained through large angles. The capability/steerInputFor APIs and AI personalities/timing tolerances are unchanged. The old automatic golden trajectory is regenerated because its TC-off alternating-steer test intentionally changes; default and explicit automatic remain bit-identical at every frame, using the same sampled frames and exact comparisons.

Run:

```sh
node tools/physics-test/maneuvers.mjs --out=.scratch/maneuvers.json
node --test tools/physics-test/maneuvers.test.mjs
```

The free asphalt pad removes walls and road limits, keeps the complete stock Vehicle tyre, powertrain and suspension simulation, and applies ordinary driver inputs. No yaw or velocity is injected after the clock starts. Donuts hold full lock and full throttle in first at 20/30/40 km/h entry. Handbrake turns use a timed lever pulse followed by throttle; the lower-power FWD case uses 80 km/h entry and a 1.5 s pulse, other cars use 60 km/h and 0.6 s. Both aided and unaided cases must complete 360°. These are heading/rotation checks, not a claim of an on-road donut in a narrow lane.

The 40° hold uses a fixed countersteer/throttle controller for each chassis, requires four continuous seconds inside 30–50° at more than 20 km/h, and starts with an actual handbrake turn in second. Recovery is a specified 45° slide at 60 km/h with 0.5 rad/s yaw, matching initial corner wheel speeds/slip states, and no further state injection. The driver eases throttle over 0.8 s and uses sideslip/rate feedback to unwind steering. The gates are less than 1.2 g lateral acceleration, less than 1.3 g change in world velocity, less than 10° opposite-angle overshoot and alignment within four seconds. A 45° state with substantially greater angular momentum can still require more time/distance to recover; this test does not promise to catch every already-committed spin.

The matrix includes 911, Z4, E36, GTV, GR Yaris and MINI. The tyre-curve check samples 10–100° and verifies no force discontinuity across sideways motion. Before/after traces and final clean-archive logs are recorded under `.scratch/tc-toggle/`.


## 2026-10-15: per-trim powertrain realism

See [POWERTRAIN.md](POWERTRAIN.md) for the complete 56-trim parameter table, sources versus simulation rules, gearbox equipment, sound event contract, regression tolerances and reproduction commands. Every parameter is in the literal CARS catalogue so browser, server/deploy readers and headless benches share it.
