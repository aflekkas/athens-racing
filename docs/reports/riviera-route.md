# Riviera on the streamed Athens world

`riviera-coast` is a forward sprint with the concrete `quick` event, two rivals,
normal graph traffic and police enabled by default. The setup offers the existing
traffic, rival, police and weather choices. Reverse and custom timing segments
remain unavailable. The route uses the same `createWorldSession`, streamer,
Vehicle, RivalAI, recovery, ghosts and records as Faros. It requests no legacy
Riviera geometry pack and introduces no world cells or new rendering effects.

The live basin source manifest used for the physical proof is
`manifests/377cd6c880ae85661c44dbec6f974a5f406c41d7e39299aed3c501f6a0d935f3.json`,
world revision `4241d71bb4d87f995cde84bbf5af3d3c11d014f5ca5e4a2055c65c42f437827e`.
It has 1,451 cells and covers every legacy Riviera reference sample. The old
Phase 2 note about 24 missing southern cells is obsolete. No R2 object was
written by this route task. World data remains in the staging bucket. A hash
comparison with the scenery publication finds 90 changed northern Faros cells
and zero changed Riviera course cells; `phase3-world-provenance.json` records it.
Integration preserves Penteli commit `33d599a7892ef63fc05f097e510c5df42d8ef747`
and binds all three routes to world set
`4e4c4622b97d2bea7056ad1d52bf48afb942db8e6b29bc124ebade7619b7b726` at
`manifests/803754cf8aa7c04ceb9161d29061436292f6fe3f42fe13bf0d468de5f7e2d6a2.json`.
Its 225 new Penteli cells bring the world to 1,676 cells; every basin cell hash
and every route geometry/hash remain unchanged. The final compressed world is
412,439,969 bytes, with the same 30,407,222-byte worst 2×2 safety set and
20,571,365-byte maximum decoder reservation. The rebase and budget evidence
are `phase3-penteli-rebase.json` and `phase3-final-world-budget.json`.

## Course equivalence

| Measurement | Legacy Riviera | Streamed route |
| --- | --- | --- |
| Timing stations | 241 → 10,548 m | 0 → 10,337.229709 m |
| Timed length | 10,307 m | 10,337.229709 m (+30.229709 m, +0.293293%) |
| Direction | Vouliagmeni → Loumbarda | Same forward direction, legal directed carriageways |
| Start | Legacy station 241 | Nearest legal directed road, 4.503550 m lateral displacement; heading differs 0.814416° |
| Finish | Legacy station 10,548 | Same nominal endpoint on emitted road, 0.150905 m displacement; heading differs 1.495730° |
| Loumbarda | Corrected native carriageway corridor | Directed OSM `w25371523`, layer −1 |

The 126-edge route follows the mapped carriageways rather than the reference
median/rock-pier line. Across 5,154 legacy timed samples the median lateral
separation is 0.450440 m, p95 6.286490 m and maximum 6.309359 m; heading p95 is
3.170726°, maximum 8.456773°. Physical heights, widths and progress timing have
changed, so equivalence is **not** claimed. The current edition is
`world-lanes-v1:f6769329091422b4f6e7cebb34bf06e31a032ac13801982cb7b091544f0f8a6a`.
The route hash is `ed1fbb1bcc10987cfc95636a979c8df75f5787684745b4d92209a98a67c4fe42`.

## Systems and history

The compiler accepts a layer transition only at a common mapped node, with a
bridge/tunnel flag, adjacent layer and continuous 3D endpoint within 2.5 cm.
Only that exact portal boundary may borrow an approach contact height; bore
interior samples must prove layer −1. Overlapping public asphalt ownership
labels no longer artificially narrow a continuous cross-section; physical gaps,
height and layer checks still bound its interval. Branches remain directed and
turn restrictions remain authoritative.

The graph adapter shares tile-owned signal phases with civilian stopping,
rival planning, finite stop-line crossing and witnessed police offences. Bore
walls occlude police sight; separate decks neither witness nor collide through
one another. Police use the native heat/arrest state, sirens and voice cues.
There are no fines or added score types. The graph fleet reserves 24 civilian
model slots plus five police slots, while admitting at most 24 civilians and
the native police limit. Reused wreck slots reset before spawning.

Concrete `quick`, `riviera-sprint` and `tt-riviera` records at legacy track version
`4718fbec` appear in `legacy-riviera-4718fbec`; original setup, car, date and time
are retained. Historical Times displays “Original Riviera track” and “Original
Faros circuit”; edition ids and hashes stay internal. Unknown versions and unversioned signatures are not guessed.
Faros aliases likewise require its exact `75a42bf0:faros-v3` signature;
`garden-v2` never appears in Faros history. Both local stores and JSON/SQLite
boards filter history by edition, including old wildcard copies. Accepted
legacy submissions after cutover upsert a migrated history copy; SQLite does
this in the same transaction as its board update. Originals remain available
for rollback. Route setup variants keep the concrete event identity and their
own setup keys; legacy-map setup eligibility is unchanged. Aligned reversing
neither earns progress nor raises WRONG WAY.

## Independent evidence

The linked feed is `/home/dev/data/agent-feed/unified-world/phase3-*`:

- `phase3-equivalence.json`, `phase3-route-validation.json` and
  `phase3-world-audits.json`: all 24 course cells pass surface, road-section,
  bridge and bore audits; 10,338 course contact samples have no missing contact
  or wrong interior layer. The cell audits cover 41,651 asphalt triangles and
  2,133,869 shoulder samples. They find 1,882 water samples among 6,144 coastal
  terrain samples, and 2,012 emitted safety segments. Whole-world surface/seam
  provenance is retained from the unchanged coast/scenery publication.
- `phase3-safety-impact.json`: 800 real Vehicle head-on/glancing cases against
  emitted coast rails and bore walls, all hitting; zero vertical injection.
- `phase3-drive.json`: a continuous full route finishes in 432.692952 s and saves
  a valid PB. The fast setup has two rivals, traffic/police off; 610 simulated
  seconds cover 13.972710 km at a peak 185.248430 km/h. All 36,600 observed body
  contacts remain asphalt; zero holds, missing contacts or page errors.
  Teleport retains earned progress/rejoin debt; reverse travels 27.53 m at up to
  25.50 km/h backward without gaining progress. This is native physics with an
  accelerated wall clock, not physical-device FPS certification.
- `phase3-network-drive.json`: the release bundle repeats the 610-second native
  run at 50 Mbit/s / 50 ms RTT with an aggregate world-payload shaper: 13.975040 km,
  the same valid 432.692952 s finish, 36,600 asphalt contacts, zero holds/missing
  contacts/page errors. Activation p95 is 1.1 ms, maximum step 8.9 ms, zero steps
  above 50 ms. Stream/JS/GPU peaks are 56,797,391 / 153,380,309 / 85,607,461 bytes.
  Reverse/teleport again retain earned progress. The same browser verifies the
  actual Historical Times text contains the human label and no edition id/hash.
- `phase3-default-systems.json`: independent 610-second default traffic/police/
  two-rival soak, zero holds or missing contacts, activation p95 0.9 ms. Its
  automated driver stalls after 4.65 km; it is a resource/system soak, not the
  full-course completion proof.
- Entry timings, setup matrix, exact-candidate test counts and staged release
  SHAs are in `phase3-report.txt`, with the final cold/warm runs beside it.

The original basin is 386,950,858 compressed bytes, its worst 2×2 set 30,407,222 bytes and
largest transient 20,571,365 bytes. At 200 km/h the route's largest mandatory
resident set is 6,490,027 bytes. The fast drive peaks at 56,797,391 resident bytes,
164,118,806 estimated JS bytes and 95,732,999 estimated GPU bytes, within the
64 MiB stream / 256 MiB JS / 192 MiB GPU low-tier limits. Entry uses a 1 ms
activation slice and restores the 0.75 ms driving slice on success/cancellation.

Ten cold release-bundle entries at 50 Mbit/s / 50 ms RTT on this shared
VPS/SwiftShader measure p95 **12.246 s cold (8 s target missed)** and
**1.2 ms main activation** across 205 frames (3 ms target passed). Ten actual
resident route selections through the menu handler, followed by controllable
countdown including the normal fade, measure **0.688 s warm (2 s target passed)**.
The paired 0.078 s restart-preparation return was diagnostic only; it excluded
the deferred reset/fade and is not the warm target measurement. Initial world transfer is 1,189,101 bytes; complete page/module-worker responses
are 10,534,019 bytes (113 requests on the uncompressed local proof server).
There are no
holds, missing contacts or activation steps above 50 ms. The failed 2 ms entry
slice measured 4.5 ms activation p95; the final 1 ms slice restores headroom.
The cold target remains 8 s. These are shared-host software-renderer results;
quiet physical low-end desktop and laptop certification is still outstanding.

The warm-selection browser check exposed an asynchronous shader/material
disposal race. Resident same-route selection now retains the prepared map,
and other warm selections compile after replacing scene materials. Rival
initial speed profiles reuse one bounded copy per vehicle/line only when the
exact capability state and method identities match; wet grip, engine damage,
mass, spec and capability overrides invalidate it. Explicit live profile
refresh remains fresh. Regression tests cover invalidation and protect the
cached array from consumer mutation. This closes the 3.764 s warm-selection
miss; cold remains a separately reported target miss.

Riviera activation is route-specific and staging-only after its independent
proof. Production remains held and receives no new world pointer. The release
train is the only deployment path. Owner locks (computer only, Lighting Off +
Effects Off, no visible checkpoints/glow/outlines, notices outside the driving
view, time-only results, at most two rivals, nearest-road tow with the 40 m route
preference) remain in force.
