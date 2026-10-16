# Airborne implementation handoff

Source/gates commit: `6c682960eea2a4353363acf2032aa58732251aec`. All gates ran in clean `git archive HEAD` copies in `/tmp`, using the existing node_modules installation. Source commits use private indexes and commit-tree/update-ref; the shared working tree/index were never written. No push, deploy or subagents.

## Result

Paved Ground.resolve used to overwrite body height and exclude paved crests from its only launch branch; small spring kicks and planar collision response could not produce free 3D motion. The new unilateral-support/free-body handoff conserves world angular momentum, disables unsupported tyre/parking/grade forces, resolves rotated hull support and suspension landings, and adds impact-point/CoM-dependent launch/tip/spin impulses. Hard vertical landings damage body/corners while retaining the existing frontal-engine damage protection. Stopped roof/side support offers tow after 2.5 seconds. Online launches bypass the old containment snap and use corridor auto-tow.

Protocol 8 adds quaternion, vertical/angular velocity and air/contact state. Client and Worker must deploy together. Authority acceptance, hibernation, resume and vertical-only remote interpolation are covered. Existing authored model/cockpit files and their source-hash fixtures remain unchanged.

## Final gates

- `npm test`: PASS; group passes {'damage': 56, 'unit': 1034, 'physics': 229, 'world': 25}.
- `node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs`: **1146 passed, 0 failed**.
- `node tools/check-browser-imports.mjs`: PASS; 257 modules.
- Browser capture: 26 frames, no page errors; all three final contact sheets opened and inspected.

The first suite attempt exposed the old proxy impulse cap, an unconditional terrain lookup in a minimal collider fixture, model-helper source hashes, and a wall-clock minute-boundary lobby flake. The model handoff moved into syncCar, retaining locked model source hashes. The second suite reached three traffic fixtures without surfaceY; airborne-only height sampling fixed them. Focused traffic tests passed 28/28. Initial and second failure logs are retained. Two intermediate standalone regression processes were terminated with exit 143 without assertion output; an earlier complete run and the final run both pass 1146 checks. The final run used only a unique process title to identify it on the shared host.

## Controlled evidence

- `crest.gif` / `crest-sequence.png`: baseline 0 m free flight; after 1.58 m, 1.33 seconds airborne, stable suspension landing.
- `barrier.gif` / `barrier-sequence.png`: real Ground._hit at 150 km/h and 45 degrees; baseline 0 m flight, after 3.50 m launch and full tumble.
- `bus.gif` / `bus-sequence.png`: emergency swerve with a prescribed 12 cm kerb trip arresting 5 m/s lateral motion; bus reaches 90.2 degrees and stops on its side. The identical 911 case reaches 11.8 degrees and recovers.
- `before.json`, `after.json`, `before.log`, `after.log`: complete controlled traces/summaries. `browser-frames.json`: frame telemetry. Full PNG sequences include time/contact labels.

The stock bus slides before its 0.93 g static tipping threshold on 0.67-grip flat asphalt. The proof deliberately uses a tripped rollover; it does not claim a pure flat-road swerve rolls the stock bus. Controlled scene/contact fixtures isolate this task; these are not named-map playthroughs. See tools/physics-test/AIRBORNE.md for model assumptions, test updates and reproduction.

## Implementation commits

```
dynamics a1ecda8773a8802d27e44ccc3c81c86db30b576d
network 7b56a218137f87071a3b95a7b0a414a8c754706d
tests ea077b3675037e8d57944739fb9d4e5d0e4d54e8
fix 4970b3d383ce766f68885079a6d79c743015ea09
trafficfix 6c682960eea2a4353363acf2032aa58732251aec
```

Concurrent roundabout work landed after the gate archive was captured. The evidence-only commit is based on current HEAD and preserves it. The recorded gate source commit above is the exact scope of validation; no claim is made that another agent's later changes were part of this run.
