# Multiplayer cost: Durable Objects and a future P2P option

Cars are sampled at 20 Hz but two samples share a message, so the arena still takes up to 10 incoming messages/s/player (more samples, the same request count; see `docs/multiplayer-sync.md`); unchanged parked cars stay quiet. The arena relays a snapshot every 50 ms with every sample since the last one; outgoing messages are unmetered. Car-to-car contact reports add at most 10 incoming messages/s/player and only while cars touch. One loaded driver simulates online traffic, sending five compact world snapshots/s, split into packets below 4 KiB. A measured 66-car/32-prop fleet uses two packets per snapshot (10 incoming world messages/s). Eight continuously moving players plus that fleet therefore use about 90 incoming messages/s: 16,200 request equivalents/hour at Cloudflare's 20:1 WebSocket ratio. The 100,000/day Free allowance supports about six such busy room-hours/day before API, reconnect and lobby overhead. Outgoing WebSocket messages are unmetered. These are capacity estimates, not a paid-plan requirement; [current Cloudflare pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) was checked 2026-10-15.

Player-hosted WebRTC data channels could materially reduce server request usage. Keep the DO for lobby membership, SDP/ICE signalling, clock synchronisation and occasional bounded progress/finish evidence. Send continuous car telemetry through data channels to the player host, which relays it to the other peers. The DO must still receive enough periodic progress to enforce its current bounded-finish checks; keeping those checks while reducing reporting to 1 Hz would cut telemetry request usage substantially, rather than eliminate it. A full mesh avoids host relay but grows to 28 peer pairs in an 8-player lobby. A host star needs only seven pairs but consumes the host's upload and adds a hop between guests.

Direct peers avoid relay bandwidth entirely. For NAT/firewall failures, Cloudflare Realtime TURN offers the first **1,000 GB/month free**, shared with Realtime SFU, then **$0.05/GB egress**. STUN is free. TURN fallback remains a metered separate service; it is not covered by the Workers Free request quota. These figures are from [Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/) and the [TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/), checked 2026-10-13.

For a rough bandwidth estimate, assume a 300-byte state sample at 10 Hz. Eight-player all-to-all delivery is `8 × 7 × 300 × 10 = 168,000 bytes/s` (~0.60 GB/hour) before encryption, protocol overhead, loss and NAT topology. Even if every destination requires TURN, 1,000 GB supports roughly 1,650 eight-player lobby-hours/month at that simplified rate. Actual host aggregation and TURN paths can change the figure; measure real packet sizes and relay ratios before committing to a budget.

P2P adds ICE negotiation/restart, short-lived TURN credentials, unreliable/unordered channel design, host election and migration, peer privacy concerns, and inconsistent mobile/background-tab hosting. Expose only expiring TURN credentials to browsers and keep the long-term TURN key server-side, as Cloudflare's [credential guide](https://developers.cloudflare.com/realtime/turn/generate-credentials/) requires. A malicious host can delay/drop state or favour players, while WebSocket clients can already falsify their client-side physics. Maintaining server-owned start/finish timing and validating progress helps either design, but telemetry moved off the DO weakens its observation unless periodic evidence is retained.

Keep the current DO architecture until measured use approaches its daily message quota. Revisit P2P if recurring concurrency consumes most of that allowance and the extra networking/testing burden is justified. This task does not implement WebRTC or provision TURN.

## Local driver names

Driver names, paint and driver presets are stored in the browser. Multiplayer
uses independent connection identities and the existing short reconnect grace
period. It makes no account, friend or presence requests and stores no identity
or customization-owner rows. A one-time transactional cleanup drops the retired
tables inside the existing SQLite DO, preserving arena state and leaderboards.
The cleanup has a KV completion marker, no scan, new binding, timer or alarm.

## Shared traffic implementation

The authority is the connected, loaded host, falling back to another loaded driver. It streams positions, velocities, crash poses, damage totals, lamps and knocked cones at 5 Hz. Guest contacts report bounded impulses back to that authority. The arena validates ownership and proximity, assembles complete frames before publishing, and encodes fan-out once. It does not run traffic physics. The full-fleet eight-client relay benchmark is `node --test server/mp-shared-world.test.mjs`; use its actual message/byte/CPU output when resizing the budget.

Packets are capped at eight parts per frame, so the absolute world ceiling is 40 incoming messages/s. Together with eight moving drivers that is 21,600 request equivalents/hour, about four busy room-hours/day after reserving room for overhead. Lobby/finish transitions persist immediately; player/world telemetry shares one arena checkpoint per two seconds. No per-frame SQL writes, new services, bindings or plan changes are introduced.
