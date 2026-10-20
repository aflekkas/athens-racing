# Crash physics (2026-10-20)

Owner, 2026-10-20: "the physics of car crashes is pretty poor right now". Make crashes feel convincing and fun, arcade-sim, not floaty,
not sticky, not a teleport.

## What was wrong (measured with `tools/crash-bench.mjs`, real `Vehicle` / `Ground` / `Traffic` / multiplayer code, no browser)

| Symptom | Root cause |
|---|---|
| Head-on at 60 km/h threw the car 1.3 m up for 2.4 s; 8 m and a roll at 160 | `impactDynamics` invented a lift (`(dv-4) x 0.18`, up to 5 m/s) and let 45 % of the blow's energy into pitch/roll torque on every wall, rail and car |
| 30 degree glance rolled the car (91 degrees at 100 km/h, 180 at 160) | same lift, applied at an offset corner |
| Glancing hit on a bridge rail stopped the car dead, every speed | `WorldTileBarriers.resolve` froze the heading, zeroed the yaw rate and multiplied the tangential speed by 0.96 on every 240 Hz substep |
| Sliding along a wall was free; a car pinned itself or slid for ever | velocity-only response at the car centre, a speed-proportional fudge instead of friction |
| A lamp post at the door was not there | the car was two circles with a hole between them |
| Corner clipped through walls by 0.3 m | circles do not cover body corners |
| Two player cars sat 1.7-3.2 m inside each other for a second; momentum off by 12-95 % | the multiplayer exchange moved velocities at the centre only, pushed 35 cm per call, no friction, no yaw, each side used a different contact point |
| Rival / AI racers: no spin, no friction | `racerPair` in `main.js` was axis-aligned boxes and a 0.6 factor |
| Cars shoved clear in one frame at speed | full-overlap separation, no time of impact |

## The model (`src/crash-contact.js`)

* Impulse AT the contact point with the car's mass and yaw inertia (x1.25: tyres and suspension resist during the blow), restitution
  0.3 for a bump falling to 0.1 for a crash (none when merely resting), Coulomb friction 0.3 (0.2 on a guard rail) along the tangent.
* One blow adds at most 2.4 rad/s of yaw rate (soft limit), never above 3.6 rad/s: a tap is not a spin-out.
* Everything touching one obstacle in a substep is one contact at the depth-weighted centre: a square hit stays square.
* The car is a capsule of circles every 0.7 m plus its four corners (a post at the door is met; corners do not poke through).
* A car dragged along a wall is helped round to run along it, leaning a few degrees off it; sustained scrape costs speed.
* After a hard hit: 0.25-1.15 s of stabilised yaw (`crashRecover`) so the car stays drivable.
* Separation by time of impact: rewind to when they met, bounce, run the rest of the step on the new velocity; whatever still
  overlaps is eased apart 12 cm per frame at most. No teleport.
* Car against car: both halves from the same frozen state, equal and opposite by construction (momentum error 0 for any masses).
  Online each driver resolves their own half (3f35e7de path unchanged: same dedupe, reports, windows), now from the same normal,
  contact point, restitution and friction on both sides.
* Out-of-plane part only from where the blow lands relative to the centre of mass; the invented lift is gone (kerbs and tyre banks
  keep their ramp). Bridge rails never lift or roll the car (owner 2026-10-18 stays true).
* Camera shake, rumble and sound scale with the velocity change (also for online contacts).

## Bench

`node tools/crash-bench.mjs --out=file.json --md` (speeds 30 / 60 / 100 / 160, cars z4 + panda, traffic sedan and bus, players
Panda / SL / bus). Before/after tables and the strips are in `.scratch/crash-physics-2026-10-20/`. `tools/crash-physics.test.mjs`
(in `npm test`) pins the properties.

## Pinned tests that were updated, and why

Old crash behaviour was pinned in `tools/physics-test/airborne.test.mjs` (a flat barrier and a car-to-car blow *launch* the car:
retargeted to a ramped face, which still does), `tools/world-tile-barriers.test.mjs` (head-on stops dead: now a stop and a small
bounce), `server/mp-playtest.test.mjs`, `tools/remote-sync-sim.test.mjs` and `tools/mp-link-sim.mjs` (closing speed shared with e = 0:
now times 1 + e(speed)), `tools/penteli-rails.test.mjs` (friction at the rail). No threshold was loosened to hide a regression.

## Lasting damage (owner 2026-10-20: "we should arguably make the damage more punishing, rn it's not punishing")

A crash costs speed *and* leaves damage that stays for the whole run. Reset and tow keep it (`Vehicle.damageSnapshot` /
`restoreDamageSnapshot`, used by `backOnRoad`, the landmark teleport and the server's `race-recovery.mjs`); only a restart (a new
car) clears it. The acute failures that stopped the car (a stalled engine, a broken driveshaft, a boiling radiator) do not survive
a tow: it comes back running, in whatever state the damage left it.

* `mechanicalIncrement(ebs, zone)` (src/damage-math.js): the hit's equivalent barrier speed in any direction, none below
  `TAP_EBS` = 18 km/h, rising smoothly (power 1.5) to a ruined car at `RUIN_EBS` = 80 km/h, times a zone weight (front 1, rear .4,
  sides .5). Hits pile up to 0.9 and stop there (crippled but running); only a terminal blow (a 90 km/h frontal) goes to 1 and a wreck.
* Power: `impactPowerFactor` = 1 - .55 d^.85 (floor 45 % at 0.9). Top speed: `impactDragFactor` = 1 + .6 d on top of the lost power
  (a ruined car tops out near 185 km/h instead of 247). Steering: `steerPull` knocks the rack towards the side that was hit (up to
  .012 rad of toe), on top of the per-corner bend near the contact point.
* Body dents (src/damage.js lattice, bumper droop, cracked glass) now start earlier and go deeper: full crush at 60 km/h front and
  rear, 50 km/h sides (was 80 / 65). Dent depth on the Z4 at 60 km/h head-on 0.33 -> 0.60 m, 30 km/h 0.07 -> 0.13 m, side 50 km/h 0.16 -> 0.28 m.
* HUD: the existing quiet damage panel (src/driving-feedback-model.js) now says what is left: power, top speed, steering pull,
  and that the damage stays until restart. LIMP MODE at 55 % power. No new HUD element, no post effect.
* Same rules everywhere: AI rivals take the same `addDamage` path (main.js), online peers sync `damage`, `impactMechanical`,
  `engHealth` as before and the server's tow keeps them, the leaderboard still records time only. A light tap (under 18 km/h,
  trading paint) costs nothing; ten 20 km/h taps cost 5 % power.

Seconds lost over the next 1.5 km, flat out, Z4 (`node tools/crash-bench.mjs --damage --car=z4`; before = the same state under
the old numbers, where a tow wiped it): 30 km/h head-on 0.5 s, 60 km/h 4.0 s, 100 km/h 7.7 s, 30 degree wall glance at 100 km/h 1.8 s,
guard rail glance 1.5 s, side hit on a post at 60 km/h 1.9 s, rear-ending a sedan at 60 / 100 km/h 0.1 / 1.7 s, T-bone at 60 km/h 0.6 s,
ten 20 km/h taps 0.5 s, four 40 km/h bumps 7.1 s. Tables and chart: `.scratch/crash-physics-2026-10-20/bench-damage-*.md`.
Pinned tests re-pinned, not loosened (`tools/damage-mechanics.test.mjs`, `tools/damage-ground.test.mjs`,
`tools/driving-feedback.test.mjs`): they asserted that anything below 40 km/h, glancing or side-on cost nothing lasting and that
a tow repaired everything, which is the behaviour the owner asked to remove.
Not changed: swapping to another car in free roam builds a fresh car (a free-roam convenience, not a race).
