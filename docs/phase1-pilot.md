# Unified-world Phase 1 pilot

The staging-only `syntagma-pilot` sprint runs on the existing Athens world:
Amalias beside Syntagma, Panepistimiou, then Omonia. Its contact-conformed timing
length is **1,456.4369117922106 m**; the validated run-out is **150.99927720594218 m**.
There are five centreline cells and seven cells in the 32 m corridor inventory.
The start grid is 8 m behind the mathematical line on the directed road.
No cells were rebaked, changed or committed.

Staging entry: `https://staging.athensracing.com/?routes=1&route=syntagma-pilot`.
The generated route picker is available at `?routes=1&menu=1`; it reads the
enabled release catalogue and adds new authored JSON files without a source
registry change. The build enables `ASR_UNIFIED_ROUTES=syntagma-pilot`; `/api/routes` publishes the
server's effective release tuple. Query parameters cannot enable a production or
unpublished route. Unified world activation and online racing remain off.
The four existing tracks retain their loading and race paths.

The main renderer, input, Vehicle, camera, EventRun, results and local PB stores
own this race. `createWorldSession()` owns tile scene/contact/graph layers and
route interest, with no physics loop. The development Athens entry also consumes
this session. The pilot is solo, traffic off, police off, afternoon/clear;
unsupported setup combinations cannot enter it. Global route boards and ghosts
remain gated until their migration. Pilot PBs use route geometry identity in both
local stores and never update the Riviera garage best.

Astra's `RouteGuidance` consumes `buildRouteGuidanceData()` without inferring turns
or race progress. Tile callbacks dispose paint with contacts, and the HUD uses
the same minimap overlay. Sol's `FinishSpectator` owns the finish transition. The
pilot has no other racers, so it reaches results immediately. Free roam creates
no race guidance; the optional existing guidance demo remains explicitly opt-in.

`planRouteInterest()` admits start/grid plus the first 300 m, prepares the first
1,000 m, and follows route bends with a measured-latency look-ahead. Start pins
release after departure. Fetch/decode cancellation, worker graph preparation,
separate layer activation steps and one-hop owner reservations keep work bounded.
A streaming interruption holds physics and timing together and makes the run
ineligible. Tow preserves damage and earned/rejoin state, checks lane/footprint,
barrier and parked-object clearance, and uses the 40 m route preference.

Route authoring and exact-source reconstruction are documented in
[data/routes/validation/README.md](../data/routes/validation/README.md).
`tools/build-routes.mjs` discovers sorted `*.route.json`, validates all identities,
and generates the picker index, immutable route artifacts and server catalogue.
The ordinary new-route integration fixture adds only another JSON, builds both
catalogues, and leaves world inputs unchanged. Legacy coverage has an explicitly
labelled cell-mask mode; a migration needs full directed-edge/contact validation.

Validation includes strict schema/unknown fields; illegal/disconnected/layer and
footprint failures; shortest-distance waypoint ambiguity; repeated-edge and
asymmetric-width projection; circuit lap coverage and start-line dithering;
line interpolation and contact-label seams; cuts/reverse/parallel roads; fixed
rejoin debt; PB/restart; staging flags; nearest-road tow and the 40 m preference;
and unchanged scenery/detail lifecycle checks after the ownership extraction.
Run the full suite under `flock /home/dev/.local/state/athens-release/agent-test.lock
npm test`, plus the physics regression, browser import and syntax gates, on the
clean candidate archive.

A local native scripted drive completed in **118.88970899755628 s**, with zero
missing contacts, zero streaming holds and both local PBs saved. This is a game
physics drive, without teleporting the racing car. Subsequent tests exercised
resident restart, a real off-road excursion and validated tow without progress
credit. Visual evidence and final measured gate counts are in the task report.

These VPS/SwiftShader development runs do not certify the plan's ten cold/ten
warm physical low-end desktop and laptop p95 benchmark, the ten-minute high-speed
network run, or outage recovery matrix. Production remains held. Phase 2 adds
Faros geometry parity, actors/traffic/police/closures, shared recovery authority,
ghost and record migration, and the remaining acceptance measurements before
replacing a native track. No production activation is part of this pilot.
