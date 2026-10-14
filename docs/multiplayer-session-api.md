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

## Checkpoint HUD hook

`hooks.checkpoint(status)` and the `race-checkpoint` window event receive
`{missed,message,next,passed,total}`. `next` is null at completion or
`{id,s,x,y,z,halfWidth}` for the next gate. `mp.checkpoint` stores the latest status,
including after reconnect. `message` is exactly **MISSED CHECKPOINT — go back**
when missed, otherwise empty. Clear the warning when `missed` becomes false.
Solo `EventRun` emits `events.on('checkpoint', status)` with `kind:'checkpoint'`
and exposes `run.checkpoint` using the same status fields.

Race gates are no more than 80 metres apart and also include existing named
sectors and the finish. They span the mapped tarmac plus a two-metre shoulder
allowance. Each forward movement segment must intersect the next gate within
its width and eight metres of road height. Twin tunnel gates follow each mapped
carriageway independently, including transitions; land between them is excluded. World-position and progress changes
are bounded by server receipt time (solo simulation time), with a five-second
maximum gap for course validation. Passing beside a gate or teleporting cannot
advance it; return behind the missing gate and cross on the road. Recovery cannot
place a driver beyond that gate. Reverse routes and unwrapped circuit laps use
ordered gates too. Existing finish distance/lateral, clock and leaderboard
validation still apply. Taxi/getaway use their existing ordered objective
reducers rather than race-course gates; free roam has no finish gates.

Accepted, relayed and restored server race state ignores legacy decal
descriptors. Paint and bounded driver appearance remain supported.

## Verification

- `npm test` includes core/Node session regressions.
- `node --test tools/checkpoints.test.mjs tools/multiplayer-client.test.mjs`
- `node --import ./tools/physics-test/register.mjs --test tools/checkpoint-routes.test.mjs`
  checks every gate on both legal Riviera/Penteli lanes and two Megara laps in both directions.
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
