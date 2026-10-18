# Recovery, standings and Psychiko direction

> **Superseded 2026-10-18.** This describes the gate/checkpoint design and the Psychiko `defaultReverse` direction contract. Both were replaced: checkpoints are gone (progress is tracked invisibly and a tow lands at the latest valid on-road pose, see `docs/OWNER-DECISIONS.md` and `docs/multiplayer-session-api.md`), and the Garden Circuit was redesigned to run in its natural direction. Read this file as history only.

Implemented against production `e72722c` in isolated branch `fix/earned-race-recovery`. No deployment, push, production pointer change, map rebuild, OSM coordinate edit, vehicle tuning or authentication change is included.

## Reproduced before editing

[`before.json`](evidence/recovery-progress/before.json) records the baseline defects with the production modules:

- Standings with an identical checkpoint cursor ranked an unearned station jump at 700 m ahead of an honest car at 65 m: the former was clamped to the next gate's 80 m bucket, which still bought a position.
- `requestRecovery()` itself accepted a supposed on-road 700 m anchor despite an unpassed first gate. The room handler separately capped that to three metres before the next gate; solo reset instead capped to the next **sector** marker. Neither path used validated current route position throughout. The direct-helper reproduction is not a claim that the room handler accepted a 700 m tow.
- Online recovery imposed a 5,000 ms hold; solo recovery added five seconds on top of the excursion, lost momentum and fade.
- Psychiko defaulted to `dir=+1`. The multiplayer reverse toggle changed the start from 0 to 12,754.7 m and flipped direction, but retained checkpoint stations from the original direction.
- Solo human/AI positions, gaps and AI finishes used raw route stations while the human's split/finish path used road-width gates. A nearby-road projection could therefore change a position without earning the course.

## New contract

`checkpoints.js` owns a **current** validated directional position, separate from the high-water checkpoint cursor. It accepts continuous physical poses on the appropriate road surface and ordered road-width gates, including unwrapped circuit laps. Legitimate reverse travel decreases the current position even when checkpoints were previously passed. Off-road/adjacent-street or discontinuous projections cannot silently increase it. Rejoining farther ahead than the departure tolerance requires returning or towing; a six-metre rejoin tolerance accommodates minor projection/edge jitter. Geometry-free test fixtures retain the existing simplified width fallback.

Human and AI solo position, rival selection, running gap and result classification use that position. AI finishes now cross all course gates with interpolated crossing times, including rivals still running after the player finishes. Running gaps are metres; seconds compare recorded finishes or recorded TT splits. Results display RUNNING or laps down instead of invented estimated finish times. Multiplayer board, driver/spectator telemetry and results use the server's same current-position ordering. The gate cursor alone cannot keep a reversing car ahead.

Both R and T recover at/before validated position, capped by the next unpassed **validation** gate. A local backwards excursion may retreat the anchor by at most one 80 m gate interval. A distant projection onto another leg/lap does not drag the anchor kilometres backwards. Production carriageway placement retains its bounded retreat to obtain a stable first physics projection. It places the whole car on the road, facing race direction, resets rigid/contact/suspension state and retains the existing camera blend and multiplayer motion-epoch discontinuity.

Ordinary solo tow/reset adds **zero** seconds. Online recovery retains a **250 ms receipt-clock placement hold**, plus the existing fade/acknowledgement transition. There is an 800 ms local rearm and a 1,000 ms server request cooldown; repeated ordinary requests acknowledge epochs without extending the hold. Waiting never accumulates a forward travel budget. Old motion epochs remain rejected after expiry and persistence/resume. Recovery cannot award a checkpoint or finish crossing. The short hold also ghosts the relocating online car under existing contact rules.

Police capture remains separate: online capture requests a **5,000 ms** server hold; an ordinary tow during that hold cannot shorten it. Solo arrest retains its existing 10-second race / 3-second free-roam hold and pursuit-busted result. Towing does not clear police pursuit rules or provide a free capture escape.

Psychiko uses `defaultReverse` at the event/catalogue layer: SP race, TT, menu fallback setup, MP and free-roam initial heading/traffic/guidance use `dir=-1`. The direction toggle means the opposite of that default, `dir=+1`. Multiplayer reversal rebuilds checkpoint stations, preserves the circuit timing line and mirrors sprint checkpoints when applicable. The reversed street-circuit grid and solo TT start sit 40 m behind the line (previously 30 m) to clear gantry supports from tall-cab cockpit views. Free roam keeps its existing 20 m clearance in the new direction. No road geometry was reversed.

Legacy Psychiko event records and online times remain stored and readable when selecting their actual direction. Local fallback maps the old forward default to the new forward toggle, and old reverse variants to the new reverse default. The MP forward toggle reads the original online board; the reverse default reads its new version. Local event records and both native/Worker leaderboard versions use a `reverse-default-v1` namespace for new writes; existing directional personal-best/ghost keys already separate routes. The opposite setup continues to have its own custom variant.

The shared server remains receipt-time authoritative and uses the existing state/snapshot cadence. Per-packet progress is **not** added to checkpoint notice messages. Persistence adds the bounded current-position/rejoin/timing cursor, not route geometry. No extra service, polling or Cloudflare paid feature is introduced.

## Evidence and scope of validation

- [`three-client-default.json`](evidence/recovery-progress/three-client-default.json) and [`three-client-toggled.json`](evidence/recovery-progress/three-client-toggled.json): three production-core clients, real Psychiko road geometry, deterministic pose replay in both directions. All clients see Alice > Bob > Charlie, then Bob > Alice > Charlie; a Charlie shortcut buys no progress; towing retains his 80 m anchor; Alice reversing produces Bob > Charlie > Alice; persistence retains that ordering; one lap cannot finish two; final classification uses validated crossings. These are server pose traces, **not** driven-physics or full-world browser recordings.
- [`driven-forward.json`](evidence/recovery-progress/driven-forward.json) and [`driven-reverse.json`](evidence/recovery-progress/driven-reverse.json): actual `Vehicle.update` at 60 Hz on a synthetic road, three cars accelerating/overtaking before any pose manipulation. Separate inverted-body/recovery/acceleration checks verify upright suspension restoration and throttle response.
- Psychiko SP race/TT replays in both directions start at the actual grid/solo spawn and cross the first gate, every sector/lap and finish; AI controller direction, spawn heading and guidance nodes are checked against real geometry. Free roam spawn/guidance uses the reverse default.
- Production R/T placement: 704 Psychiko samples plus all three other maps, both directions, road edges, side-road state, first real Ground step, heading, checkpoint, MP and invalid-anchor cases.
- Gantry clearance: **13,510** actual cockpit/map/event/grid-slot combinations pass, including the reversed Psychiko bus approach. Geometry and timing lines stay unchanged.
- Recovery regression tests verify 250 ms receipt authority, no purchased forward progress from hold time, ordinary-request replay, stale epochs, persistence, and a captured driver's unchanged five-second hold through restore.

Native collaborative browser proof uses actual `Hud.update`, `Multiplayer.telemetry` and `renderLiveBoard` with the three-client trace: [leading](evidence/recovery-progress/hud-leading.webp), [overtaken](evidence/recovery-progress/hud-overtaken.webp), [reverse travel demotes](evidence/recovery-progress/hud-backwards.webp). The fixture labels itself as a deterministic replay. The actual Psychiko world attempt stalled at **40% / BUILDING PSYCHIKO** for 127 seconds, and was abandoned. There is **no full-world browser pass claim**. The generated fixture file is removed; `tools/recovery-browser-proof.mjs` can regenerate it after the trace test. Owned native tabs and the local server were closed.

An initial `npm test` was explicitly cancelled after **139.1 s** (exit 1) when newly introduced focused failures had been identified and other owners' full-world jobs were active. Its log includes those pre-correction failures (side-road return fixture, wide-lane route context, physics stub import and reverse gantry clearance) and terminated world/physics/unit groups. The final focused reruns correct those failures. That cancelled invocation is **not** a full-suite pass; root owns consolidated full-suite/world/release verification.

Focused commands and final clean-archive results are recorded in `evidence/recovery-progress/checks.txt`. No push or deployment was run.
