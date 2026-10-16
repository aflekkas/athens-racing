# Airborne and impact dynamics · 2026-10-16

## Diagnosis (baseline 492f14e)

- `Ground.resolve` forced `y` to its support plane on all paved surfaces. Its only crest launch branch explicitly required `!paved`; paved ground slope also forced `vyS = 0`.
- The four-corner suspension already had unilateral tyre loads, but these primarily moved the body visually relative to the forcibly placed root. Commercial droop stops bypassed the spring's non-pulling clamp.
- Tyre capacity had a minimum of 1 N even without support; airborne surface grip was 0.02 rather than zero. Rolling resistance, grade acceleration, parking yaw and stop damping still operated without contact.
- Walls and player proxies changed XZ velocity and damped yaw. Small heave/roll spring kicks were absorbed by the suspension. Traffic crashes already carried vertical/roll/pitch state, but impulses on the player's full vehicle did not.
- `containOnlineVehicle` teleported cars outside the online road envelope back onto the route. It now yields to the existing corridor recovery for dynamic launches.
- Remote snapshots carried visual spring offsets and XYZ position, but no vertical/angular velocity or full rigid orientation. Render prediction advanced only XZ/yaw.

## Model

Ordinary contact retains the existing tyre, powertrain and four-corner suspension model. A persistent negative normal acceleration over a crest, complete spring/wheel unloading, loss of the lateral support edge, or a sufficiently hard collision releases the body into `airborne-dynamics.js`. A 20 ms crest requirement and the existing 3 m curvature sampling reject small road seams.

Free motion integrates a normalized quaternion and **world angular momentum**, with orientation-dependent diagonal inertia, gravity, and existing horizontal drag. Orientation changes reproject horizontal velocity without rotating translational momentum. Tyre normal force, drive/steering/braking force, grade force, surface resistance, parking assistance and rest damping are disabled while the rigid body owns motion. Wheels still spin through the powertrain. All spring totals are nonnegative; a momentum-conserving internal droop constraint limits a hanging wheel without pulling on the terrain.

Wall, kerb and car impulses include the hit point relative to the CoM, mass, normal delta-v and a modest upward deflection for rising bumper/rail/kerb contacts. This is a game-scale contact approximation, not a deformable collision mesh. Added rotation/lift is bounded by dissipated normal collision energy; tyre barriers transfer less launch energy. Small scrapes/parking knocks remain in the old contact model. Static obstacles above the car still collide; a flying car can clear a low rail. Already-solved yaw moments are not applied twice for traffic/kerbs.

A rotated wheel/hull support set samples the actual terrain. Sequential normal/friction impulses resolve roof/side landings, and penetration projection prevents tunnelling through the support plane. Maximum substeps are 1/240 s in free motion, with an additional 0.3 m horizontal travel limit. Upright landings hand vertical/angular motion into suspension compression, retaining wheelbase/track load transfer. Vertical closing speeds over 5 m/s can dent the body; over 7 m/s progressively damages corner alignment. Ordinary bumps remain outside the frontal mechanical damage budget. The engine is not ruined by a vertical normal.

Stopped roof/side support offers the existing tow after 2.5 s. Translation, vertical speed and angular speed must be low. Off-corridor launches use the existing auto-tow/countdown; dynamic poses do not advance the safe road anchor.

### Rollover interpretation

The stock Citaro has hcg 1.12 m, track 2.09 m and grip 0.67. Its static untripped tipping threshold is about **0.93 g**, beyond its stock flat-road tyre friction. It should slide before rolling in an ordinary flat-road swerve. The bus/sports regression therefore uses the same severe swerve plus a **12 cm kerb trip arresting 5 m/s of lateral motion**, at the tyre contact. The bus falls onto its side; the low 911 returns to its wheels. This explicitly tests a tripped rollover rather than artificially lowering the bus tipping threshold. The support-edge/energy criterion also releases tall vehicles if extreme cornering actually overcomes their support.

## Multiplayer deployment

**Protocol 8: worker and client deploy together.** Protocol-7 tabs reload through the existing incompatibility flow. Player state adds `bodyDynamic`, `air`, normalized `bodyQ[4]`, `vy`, and world angular velocity `angularX/Y/Z`. Server validation bounds velocities/quaternion, Worker hibernation preserves them, and resume reconstructs physical angular momentum. The existing authority bounds XZ/progress and permits ballistic Y; no height-to-road anti-cheat restriction was added or relaxed. A real core test accepts a jump and still rejects a 5 km horizontal teleport.

Rendering slerps the quaternion, uses endpoint vertical velocities for a Hermite jump arc, and predicts bounded gravity/rotation during a missed packet. Vertical-only and rotation-only movement cannot be suppressed as parked state. The existing 350 ms prediction/freeze limit remains. Shared-world NPC crash rows already include Y/VY/roll/pitch/angular rates; their format and ownership are unchanged.

## Deliberate regression updates

- `damage-ground.test.mjs`: replaces the blanket assertion that a 12 m/s landing never damages anything with gentle/hard landing cases. Gentle landings compress springs; hard landings damage corners/body while frontal engine damage remains zero.
- `tyre-impact.test.mjs`: retains exact crush calibration and metadata, but replaces exact **planar** post-resolve rebound with bounded restitution ordering, because resolving an off-centre 3D support contact also changes horizontal momentum. Direct `_hit` restitution tests still check the actual normal impact response.
- `airborne.test.mjs`: jump/stable landing, angled 150 km/h barrier launch/tumble, bus/911 trip comparison, parked flat stability, gravity/angular momentum, zero unsupported tyre force, non-pulling springs and roof-first anti-tunnelling.
- `airborne-network.test.mjs`: vertical/quaternion interpolation, vertical-only sender motion, validation/hibernation, actual authority acceptance/teleport rejection, stopped rollover tow and no online airborne snap.
- The deterministic `regress.mjs` includes the four scenario cases, without weakening its existing handling/catalogue gates.

- `server/mp-playtest.test.mjs`: the former 8 m/s proxy cap is replaced with mass-sharing crash impulses (45 m/s numerical ceiling). The equal-mass rear-end test now expects a 10 m/s change rather than 8; a production Vehicle test verifies local launch and unchanged remote authority.

## Evidence and reproduction

`.scratch/airborne/` contains before/after JSON traces and summary logs, three GIFs, three contact sheets and 26 full-size browser frames. Baseline logs run the same controlled surfaces against 492f14e; the legacy kerb response is a damped spring kick because there was no free-body impact method. Barrier evidence calls the real `Ground._hit`. Browser evidence uses production vehicle models, Ground and Vehicle, with controlled asphalt geometry; the bus kerb contact is prescribed to isolate the CoM comparison. It is not an uncontrolled playthrough of a named map.

```sh
node --import ./tools/damage-test-register.mjs tools/airborne-logs.mjs after
bash tools/browser-slot.sh node tools/airborne-evidence.mjs
node --import ./tools/physics-test/register.mjs --test tools/physics-test/airborne.test.mjs
node --test tools/airborne-network.test.mjs
```

The captured crest, barrier and bus sequences were opened and visually inspected. Scene shadows make wheel/road separation visible, and each frame records time, speed, height, vertical velocity, tilt and contact state.

## Dissipative tumble contacts · 2026-10-16

The original hull solve had three sources of excessive rebound: friction used
slip measured before the normal impulse, successive passes could only add
normal impulse, and penetration projection added unbudgeted potential energy.
A rapidly spinning rigid corner could also vault the body upward even while
losing some energy overall.

Contacts now accumulate normal and tangential impulses, allowing earlier
impulses to unwind as the manifold converges. Slip is recomputed after each
normal solve. Restitution is 0.12, scraping Coulomb friction is 0.65 (ordinary
upright wheel-edge pivots retain 0.55). A hard descending non-upright strike
uses a plastic crush approximation: at most 12% vertical rebound and 20% retained
angular momentum, dissipating spin rather than repeatedly vaulting on a corner.
Crushed bodies retain the rigid scraping solve until aligned and nearly stopped;
this prevents the spring handoff from instantly restoring freely rolling wheels
mid-crash. Intact crest landings still hand directly into suspension.

Each hull-contact substep budgets total translational kinetic, rotational
kinetic and gravitational potential energy from before gravity/orientation
integration. Penetration projection is charged against the remaining kinetic
energy. `airborne-scenarios.mjs` independently wraps the public Ground contact
entrypoint to measure energy before/after every actual hull solve, including
settled support. The three new tests use the production Ground._hit barrier
path in the existing damage harness, and all three fail numerically on fe3ef4f.

The refreshed before/after JSON includes true CoM (`cy`), full 60 Hz barrier
traces and per-substep contact energy. `maxHeight` retains the historical root
height convention (`cy - hcg`); CoM is 0.45 m higher for the 911. Rebound peaks
are local maxima with more than 1 cm prominence above their preceding minimum;
rest requires horizontal speed, absolute vertical speed and angular speed all
below 0.2 continuously through the remaining 8 s simulation.
