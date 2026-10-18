# Multiplayer session controls and course validation

`window.__multiplayer` provides presentation-independent commands. The server
rechecks host identity, lobby state, car rules and rate limits.

- `startRace({ force: true })`: force starts a waiting lobby with at least two
  connected drivers. All connected players become starters, including unready
  players; disconnected reservations leave the room. This keeps friends together
  without requiring an additional spectator flow. Starting from results prepares
  a rematch first. Force start allows one successful action per second per lobby.
- `kickPlayer(id)`: host-only in waiting/results; self-kicks are rejected. Removes
  membership without closing the transport. One successful kick per second.
- `unblockPlayer(id)`: host-only in waiting/results; clears that player's block.
  One unblock action per second. `lobby.blockedPlayers` exposes `{id,name,until}`;
  clients should hide expired entries using server-adjusted `mp.now()`.
- `changeCar(carId)`: allowed in waiting/results, including while ready, loading
  a map or after reconnect. Clears readiness. `canChangeCar` reports the lifecycle
  rule; `allowedCars` supplies the grid filter. During countdown/race car edits
  are rejected. Result racer records keep the car actually used in that race.
  Shrinking a filter selects the first allowed car for affected drivers and
  clears their readiness; rejected config edits never mutate car filters.
- `setCarPickerOpen(true/false)`: opening an independent garage/detail view
  prevents lobby updates from restoring the room panel over the picker.
- `retryMap()`: retries a failed lobby-map preparation.

No new DOM IDs are required. Constructor, lobby layout and garage controls are
owned by the UI owner. Bind the methods above; existing `ready` packets remain
compatible, while `car` packets explicitly update just the selected car.

A kick emits `kicked` with `{lobbyCode,until,message}`. The client clears room
state, opens the browser and shows the message; `hooks.kicked(packet)` can style
it. `mp.kickCooldown` exposes the cooldown. Join rejection includes
`code: 'KICK_COOLDOWN'`, `until`, and `lobbyCode`. The 30-second block matches the
session token, persistent driver ID, signed identity or source IP, so a fresh
socket/identity cannot immediately bypass it. IP matching can temporarily affect
new joins from the same shared network; the host can unblock immediately.
Existing members are unaffected. Blocks persist across DO hibernation; no new
bindings, subscriptions or periodic cooldown alarms are needed on the free plan.

## Route progress (no checkpoints)

Owner decision 2026-10-18: there are no checkpoints. Nothing about progress is shown
or sent: the server no longer emits `checkpoint` messages, snapshots carry no
checkpoint status, and the client has no `applyCheckpoint`, `hooks.checkpoint` or
`race-checkpoint` event. Standings rows are `{id, progress, finish, dnf, position}`.

`src/course.js` tracks each driver's progress along the route invisibly, in solo
(simulation time) and on the server (receipt time):

- Only **continuous, on-road** movement advances progress. Each pose must lie on
  the mapped tarmac (a two-metre shoulder allowance, eight metres of road height;
  twin tunnel bores are tracked per carriageway), the step must stay within the
  speed budget (30 m + 150 m/s of elapsed time, at most five seconds), and the
  straight chord between two consecutive poses must itself follow the road
  (sampled every eight metres, with a five-metre allowance for bends).
- A shortcut, teleport or cut across a block earns nothing. After leaving the route
  the car may rejoin only as far ahead as the distance it actually drove off the
  route (plus six metres); anything further is held until the car goes back or is
  recovered. A brief excursion that comes straight back costs nothing.
- A finish needs the whole route covered (`reached` >= event length; every lap on
  circuits) and the existing finish distance/lateral, clock and leaderboard
  validation still apply. Timing sectors (`sectors`, shown as split times) are only
  interpolated times on that tracked progress.
- A tow, reset or server recovery lands at the car's **latest valid on-road pose**
  (`courseRecoveryPose`), facing race direction, never at an earlier point, and
  never beyond what was earned. History restarts there (`restartCourseAt`).
- Solo shows one notice if the car passes the line with part of the route skipped;
  online the finish is simply not awarded (the wrong-way and return-to-road
  notices are unchanged).

Taxi/getaway use their existing ordered objective reducers rather than race-course
tracking; free roam has no finish.

Accepted, relayed and restored server race state ignores legacy decal
descriptors. Paint and bounded driver appearance remain supported.

## Verification

- `npm test` includes core/Node session regressions.
- `node --test tools/course-progress.test.mjs server/course-validation.test.mjs tools/multiplayer-client.test.mjs`
- `node --import ./tools/physics-test/register.mjs --test tools/course-routes.test.mjs`
  sweeps every Riviera/Penteli event and seeded taxi/getaway itinerary in both
  directions, through each lane centre and inner/outer road edge, against server
  and solo geometry. It includes paired packets, the tt-coast tunnel-mouth regression
  and two Megara laps in both directions.
- `MP_WORKER_BASE=http://127.0.0.1:<private-port> node --test server/session-transport.test.mjs`
  runs the same socket contract on a local SQLite Durable Object via `wrangler dev`.

## Connection protocol and release safety

`src/multiplayer-protocol.js` exports `MULTIPLAYER_PROTOCOL` (currently **1**).
Bump it only when an incompatible multiplayer wire format or message meaning
changes. A new asset/build release with compatible packets keeps the same value.
The build id from `<meta name="asr-build">`, when present, is informational;
matching protocols with different builds are always accepted.

The client sends `protocol` and optional `build` in `/ws` connection query metadata
and in `{type:'hello',protocol,build}`. Node and the Worker Durable Object validate
the connection before sending the normal greeting. Missing/invalid protocol is
version **0**. A mismatch receives `{type:'reload',reason:'update'}` and closes with
code **4001** (`Game updated, reload`), without allocating a lobby/session.
Old hibernated sockets are checked on restore and before processing commands too.

The client handles either the reload message or the update close code by stopping
state sends, pings and reconnect timers. A small persistent `.mp-update-notice`
shows **Game updated, reload** and a **Reload** button. `mp.reloadRequired` exposes
this state; `hooks.reloadRequired({reason:'update'})` allows presentation adapters
to respond. Build-id differences never trigger this notice. The service worker
does not intercept `/ws`; this handshake is independent of static asset caching.
