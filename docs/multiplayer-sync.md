# Multiplayer car sync and contacts

How other drivers' cars get onto your screen, and how a collision between two drivers is decided. Written after the 2026-10-18
two-player playtest ("cars move step by step", "some people can ram into others' cars, while others can't").

## The path of one car sample

1. **Sender** (`StateSender`, `src/multiplayer-state.js`). Each frame offers the car's physics state; a sample is taken when 48 ms have
   passed on the sender's clock (`STATE_INTERVAL_MS`, 20 Hz), so a 60 fps machine samples every 50 ms and a 15 fps machine every frame
   (66 ms). Samples carry the sender's own clock (`sampleTime`) and how long they waited to be sent (`sampleAge`). Two samples share a
   message, so the arena still receives at most **10 messages per second per driver** (`docs/multiplayer-cost.md`); a server that does not
   advertise `stateBatching` keeps the old 10 Hz single states.
2. **Arena** (`server/core.mjs`). Validates each sample against the race, stamps the arrival time (`stateAt`) and keeps every accepted
   sample since the last snapshot. Every `RELAY_MS` (50 ms) it sends one snapshot with each driver's newest `state` and the earlier
   samples as `trail` (motion fields only, oldest first, each with its own `stateAt`). The snapshot is encoded once for all recipients.
   Trails are keyed by race, cleared by a recovery/tow and never cross a restart.
3. **Receiver** (`RemoteTimeline`, `src/remote-timeline.js`). A per-driver jitter buffer. The car is drawn `delay` behind the newest data it
   could hold: `delay` = 90th percentile of how late recent samples arrived relative to the best path + the largest gap between samples +
   15 ms, between **100 and 280 ms** (starts at 180, grows at once, shrinks 3 % per sample). Position is a cubic Hermite through the
   samples' positions and velocities, yaw takes the short arc, body rotation is slerped. The playhead is monotonic and its rate is
   slew-limited (0.9x to 1.05x, 0.3/s), so re-timing is never a speed step. Extrapolation exists only for a late or lost packet: at most
   350 ms, then the car freezes with its wheel speed; when the data returns the extrapolation error is bled off over about 250 ms instead
   of snapping. Ranking and finish validation never use this pose.

The clock is the sender's `sampleTime`, aligned to the receiver's clock by the lowest arrival lag in the last 10 s. Nothing depends on the
sender's frame rate or on packet arrival rhythm.

## Contacts

Every driver owns their own car, so each client resolves its half of a hit (`src/multiplayer-contact.js`, `ContactCoordinator`):

- **Both sides test against where the other car most likely is now** (`RemoteTimeline.predict`: the newest sample dead-reckoned across the
  time it spent in flight and in holds, capped at 500 ms, `stale` beyond that), not against the drawn pose. The drawn pose trails by the
  jitter buffer plus latency: a rammer drove into a car that was already metres ahead, and the car it hit never saw anything arrive.
- **The contact normal is the shallowest axis the cars are closing along**, so a pose that arrives deep inside the other car is still a
  head-on hit.
- **A side that detects a contact reports it** (`contact` message). The arena relays it only to the named driver, and only when both are
  racing, within 30 m, the numbers are bounded, the nonce is new and the sender is under 10 reports a second. The receiver applies the
  matching impulse to its own car (its own velocity against the reported one, both masses) unless it already resolved that contact.
  The reported velocity must match what the receiver knows of the reporter (25 m/s), so a report cannot buy a bigger shove.
- **One contact, one application.** After an exchange, or an applied report, that pair is settled for `contactWindow(rtt)` (round trip x 2
  + 250 ms, 450 ms to 1.5 s): further local detections and reports for the pair are ignored, because the other car's predicted velocity
  is still the pre-impact one. Each side's impulse is `closing x otherMass / (mass + otherMass)`, so with both applied once the cars end at
  the common velocity.
- Towed, finished, retired, disconnected and not-yet-loaded cars are ghosts. Damage is applied once per contact (600 ms cooldown).

## Tools

- `node tools/mp-link-sim.mjs --sender-fps=15 --net=bad` : deterministic virtual-time simulator of two drivers through the real sender,
  arena core, intake, timeline and contact code (`--collision` for the ramming grid). Nets: `none`, `lan`, `mid`, `rtt150` (150 ms round
  trip +/- 50 ms, 1.5 % retransmit stalls of 300 ms), `bad` (150 ms each way +/- 50 ms, same stalls).
- `tools/browser-slot.sh node tools/mp-two-client-browser.mjs --scenario=smooth --out=DIR` : two real browser clients, a real server
  with stub Google sign-in (or `--target=https://staging.athensracing.com` with `SMOKE_TOKEN`), a shaped WebSocket, a CPU-throttled,
  frame-capped slow client and an autopilot; measures the other car's drawn position error, step metric and invisible time.
- Guards: `tools/remote-sync-sim.test.mjs`, `tools/remote-motion.test.mjs`, `server/mp-contact.test.mjs`.

## Measured (15 fps sender, 20 s of a curving, accelerating car; deterministic, seed 7)

See the commit message of the sync change for the before/after table; rerun the simulator on any commit to reproduce.
