# Open problems and good places to contribute

This is the list of things that are broken, rough or missing in Athens Racing right now. **Every item here is open for anyone to pick up:** people, AI agents, first-time contributors. If you want to help and don't know where to start, start here.

Production is https://athensracing.com, last checked at `a8eaa73` on 2026-10-22.

## How to contribute a fix

1. **Pick one item.** Check the GitHub issues and open PRs first, so you don't duplicate work. If nobody has it, open an issue titled with the item name (e.g. "Off-track is too harsh") and say you're on it.
2. **Read the rules once.**
   - [`CONTRIBUTING.md`](../CONTRIBUTING.md) explains the branches, PRs and checks.
   - [`docs/OWNER-DECISIONS.md`](OWNER-DECISIONS.md) lists the locked decisions. Don't undo these.
   - Short version: PRs go into `staging`, one fix per PR, CI must be green, and screenshots are required for anything visible.
3. **Set up and reproduce first.**
   ```sh
   git clone https://github.com/aflekkas/athens-racing.git && cd athens-racing
   git switch staging && npm ci && npm start     # http://localhost:8000
   git switch -c your-name/short-fix-name
   ```
   Reproduce the problem locally, and take a **before** screenshot or short clip.
4. **Fix it in small steps.** Use the "Where to look" pointers below as a starting point, not the full answer.
5. **Prove it.**
   - Run `npm test`, plus the physics, syntax and import checks listed in CONTRIBUTING.md.
   - Add or update a test that would have caught the problem.
   - Take an **after** screenshot from the same spot.
6. **Open the PR into `staging`, using the template.** It has two parts:
   - **A short top half for a human reviewer:** a plain-words summary, a **video, GIF or screenshot of the fix working** (before and after), steps to try it, and the risk.
   - **A detailed collapsed half:** how you did it, **which tools and AI models you used for which part**, every file and why, the exact test commands and results, and the known limits.

   You must have **tested it yourself**: played the fix in the real game, not only run unit tests, and written down what you did and what happened. PRs without visual proof or real testing are sent back. Link the issue.
7. **Update this file in the same PR.** Move the item to "Fixed" with a one-line note. Add anything new you found under "Open".

**Ground rules for every fix:**
- The game is desktop only (computer, keyboard/mouse/gamepad).
- Racing is time only: no XP, money or unlocks.
- No glows, outlines or visible checkpoints, and notices stay out of the driving view.
- Only free Cloudflare services.
- **Never commit third-party media.** Street View, Google Maps captures, web photos and unlicensed audio go in the git-ignored `.reference/` folder only.
- Our own game screenshots are fine.

Difficulty: 🟢 good first fix · 🟡 medium · 🔴 deep / needs care.

---

## Open: reported by the owner (most important first)

### 4. Unrealistic terrain 🔴
**What's wrong:** the ground and roads rise and fall in big unrealistic lumps and dips that real Athens streets don't have.
**Where to look:**
- `src/athens-ground.js`
- `docs/world-roads.md` and `docs/world-tiles-format.md`
- the world bake tools in `tools/`
- the gates in `tools/road-terrain-level.test.mjs`

**Done when:** city streets feel flat-to-gently-sloped like real Athens, and hills only appear where real ones are, such as Lycabettus and Penteli. The existing gates (≤30° asphalt, 15 cm step, ≤45% grade) aren't enough to make it feel right; add a smoothness check.
**Note:** any world rebake must be uploaded to BOTH R2 buckets; see "Lessons" below.

**In progress (2026-10-23, not published):** a 27-cell prototype passes physical/contact/seam checks and improves several urban roads, but its broader kernel lowers the hosted Lycabettus peak by about 26 m. Global baking is now blocked by an explicit geography-acceptance guard. A replacement tested on five cells preserves the hill better but fails unchanged Syntagma and Lycabettus comfort checks; it is rejected too. Neither prototype establishes full-world fidelity. All 3,647 authored Psychiko pieces must remain intact; the reduced candidate restores all 825 affected authored indices, with 2,822 in unchanged cells. See `.scratch/smooth-terrain-seams/README.md` and `docs/plans/terrain-ekali-world.md`.

### 5. Parked cars look chopped, and the roads have artefacts 🟡
**What's wrong:**
- Parked cars are cut off or chopped, and some render as flat slabs or look boxy up close.
- The road surface has artefacts, such as patches of road texture spilling onto pavements and odd seams.
- The surroundings sometimes just look rough.

**Where to look:** `src/athens-props.js`, `src/athens-detail.js`, `src/athens-ground.js`, `src/athens-materials.js`, `docs/world-dressing.md` and `docs/world-beauty.md`.
**Done when:** parked cars read as whole cars at every distance; there are no road patches on pavements and no visible seams. Include before/after screenshots from Glyfada, Syntagma and Psychiko.
**Implemented (2026-10-22, `45704212`):** reset leaked contact-shadow scale; sparse shared parking density, complete asphalt/support/clearance checks and stop/crossing exclusions; correct classic asphalt flags and drape fully contained road decals. 29 focused regressions pass. Matching staging evidence: `/home/dev/data/agent-feed/fix-wave/parking/`.
**Remaining:** inherited road/terrain mesh seams, visible around Syntagma, need the separate terrain fix in item 4. Untagged driveways are inferred from road mouths and empty runs. No world rebake or R2 upload in this parking/decal change.

## Open: other known issues

- 🔴 **Slow first load.** Cold load is still above the 8 s target: Megara about 8.1 s, Penteli hill about 9.1 s.
- 🔴 **Unified-world migration needs final parity proof.** Candidate source removes normal per-track runtime loading and supports immutable route/grid identities, streamed recovery and physical shared NPC transport. Solo Megara/Penteli direct entry is browser-verified; final two-client racing, reconnect, tow, full-domain recovery, police authority and atomic all-route activation remain required. Online remains disabled.
- 🔴 **Kifisias and major infrastructure fidelity.** Three sampled upper bridge orders match source tags, but this does not validate the uniform lower-road depression. The circular interchange is actually omitted by the existing stacked-deck/short-approach policy. Dated reference/profile reconciliation and supported structural context remain open; do not invent walls or piers.
- 🟡 **Floating and arbitrary road paint.** Exact offline asphalt draping and legal-junction kerb inference have matched local Glyfada/Vouliagmeni proof. Existing hosted cells still need coordinated immutable repacking and publication; this is not a worldwide deployed fix. See `.scratch/road-markings/README.md`.
- 🔴 **NPC routing and passing.** Candidate fixes layer/owner transitions, measured directional lanes and continuity, with dense footprint validation. Matched native-game tests now pass the Loumbarda reverse tunnel entry/exit and passing a parked player on a measured two-lane road; longer Glyfada/Quick drives and final combined proof remain pending. A rejected planner curve alone is not evidence of a missing road.
- 🔴 **Kefalari remains too sparse.** The new circuit has completed race/TT/tow/free-roam proof, but its streetscape is not yet faithful to the leafy real area. Bounded safe setback planting and materials are implemented; mapped garden/wood/tree ingestion and cleared scenery-cell reduction are in progress. Generic residential urban material is not surveyed paving.
- 🔴 **Ekali is not playable yet.** A source-reviewed 2.117 km candidate follows all 56 legal directed traversals, including the corrected one-way roundabout. Twenty authenticated DEM-backed source cells pass physical gates, 33 seams and all 13 old north-line portal checks. Development compilation now passes the legal route, grids, run-in and runout using the corrected width query, without expanding proof caps. However, 19 of 20 source cells fail the unchanged comfort guard somewhere; final terrain binding, scenery and actual driving remain outstanding. See `tools/maps/ekali/SOURCES.md`.
- 🟡 **Ellinikon Tower fidelity.** A 160 m generic building near the published tower location is present in the hosted cell; there is no named bespoke tower model. Generic presence does not establish architectural or construction-stage accuracy.
- 🟡 **Car dirt/scuffs need appearance proof.** Candidate cosmetic paint shaders use loaded loose-ground contacts and local impacts, hidden online and with World detail Off. Actual-parent Low proof passes loaded dirt accumulation, local impact scuffs, tow cleanup and hidden Off/online pixel checks. A separate High run passes the same appearance lifecycle and hidden-state checks. Exact archive gates and final combined verification remain pending; offline hidden-state tests do not establish multiplayer driving parity.
- 🟡 **Driving UI final verification.** Local controller/keyboard tips, opaque no-blur track card, and Race/Time Trial menu-to-track flow are browser-verified. Exact full archive gates and combined release verification remain pending; see `.scratch/driving-tips-event-choice/README.md`.
- 🔴 **Megara recovery graph loses physical surface identity.** All 132 surveyed samples in original cell `-64,-1` find asphalt but fail graph/contact surface equality (`surface:roads` versus `surface:megaraNetwork`). The importer emits the same network with different graph/contact labels. Correct the source metadata and reprove the full regional domain; do not widen runtime aliases or treat the cell as empty. Online activation remains fail-closed.
- 🟡 **Unsupported residential infill.** Source evidence rejects ten generated 4–7-storey bodies around the actual Artemidos comparison view. A strict local repair removes their authoritative building and collision rows with physical/CSR checks; common-world assembly, dynamic driving and faithful streetscape proof remain pending. Body removal does not establish private garden locations.
- 🟡 **Road width queries skipped contact bins.** Exact line/bin traversal fixes two demonstrated Ekali false corridor rejections while retaining physical guards. Focused regressions and development route compilation pass; final route proof regeneration, own-game comparison and combined gates remain required.
- 🟡 **Physical rider lifecycle verification.** Native before/after collision frames show rider ejection and protocol tests cover world-space replay. The driverless-bike recovery guard passes a matched eight-second native-game comparison; actual two-client replay and final combined gates remain pending.
- 🔴 **Independent review blockers (2026-10-23).** Infill repair source closure must reject empty relevant multipolygon relations even without unresolved-member records. Multiplayer authority demotion must clear the traffic authority flag so a former host cannot eject a rider privately. Both corrections now have scoped independent approval: authority lifecycle in review 6 and strict nested-source rejection in review 7. Fresh physical-plan validation and final combined approval remain required.
- 🔴 **Release access unavailable in this workspace.** Wrangler is unauthenticated and the expected release train is unavailable; restore the normal verified release path before combined staging/production publication. No new world or online feature has been deployed from this branch.

## Lessons from releases (read before touching the world or deploys)

- **World rebakes upload to the staging bucket only.** Before production points at a new world manifest, copy every file it depends on to the production bucket. Guard `a8eaa73` now blocks a production deploy whose manifest is missing.
- **A failed commit is never retried on its own.** After a failure the release train skips that commit until `~/.local/state/athens-release/failed` is removed.

## Fixed

- **Race Setup navigation, signed-out Top 3 and current release notes (verified locally 2026-10-23):** existing fixes `c2bc4672` and `ce5cfa7e` are present. Real Faros deep-link Escape returns to the picker; signed-out fixture copy leads to the real sign-in action; the actual current version shows one-car-per-model notes without the obsolete trim image. Five local browser checks pass with no page errors. Evidence: `.scratch/ui-verification-2026-10-23/README.md`. This verifies current source, not a new deployment.

- **Free-roam mirror is a still picture (2026-10-22):** the standalone Athens free-roam render never ran the mirror pass, so the interior glass kept its static fallback texture and ignored Settings → Graphics → Mirror. It now renders the live rear view with the same Off / Low / High gate as races. Same fix wave: cockpit is the default view (C toggles POV/outside), B is hold-to-look-back in every Athens view, hood POV retired, position cycling moved to P with default migration. Browser evidence: `/home/dev/data/agent-feed/fix-wave/mirror/` (two driving shots with changing mirror content, one Off shot).

- **3. Direction arrows (2026-10-22):** Quick Race now shares faint road chevrons with the streamed routes; larger, width-bounded marks sit beside the car, cover within-edge bends, and fade over a speed-based approach. One 128-instance pool, no glows or gates, and no world rebake. Browser evidence: `/home/dev/data/agent-feed/fix-wave/direction-arrows/`.

- **1. Psychiko buried under generic buildings (2026-10-22):** restored all 3,647 authored pieces with the original building kit, surveyed facades, roofs and tile-owned collision; excluded generated lots from authored villa gardens and footprints; stationary spawns finish loading walls, trees and frontage details. Matching centre views: `/home/dev/data/agent-feed/fix-wave/psychiko/`; native day/night budgets recaptured and 32 focused regressions pass. No world rebake.

- **2. Race finishes / harsh off-track handling.** Short kerb/verge/roundabout cuts preserve progress without notices; prolonged departures guide back without resetting. Accepted station crossings time every split and finish; headless regressions drive all six Quick Race routes and their full lap counts.

- **Driving map overlay (2026-10-22):** kept both M ranges compact, replaced resident-cell/500 m street clipping with the published-world street overview, restored sea/coast and area labels, and added a calm race route with a labeled finish instead of the tiny green flag. Nearby streets prepare first across frames, independently of the coast, and cache by view; area, turn and destination captions use separate rows. No world rebake.

- **Traffic pile-up (2026-10-22 follow-up).** Junction asphalt widening moved lanes sideways, random successors selected immediate U-turns, and cars switched edges without a continuous turn. Traffic now keeps a stable lane, checks complete lanes and turning footprints through shared spawn/driving admission, yields at junctions, backs out of trapped turns when the rear is clear, and passes a parked vehicle using a spare lane with a checked exit. Curve construction and forward/reverse movement sample live ground height, layer and surface owner. Density drops around queues, occupied/stalled segments reject new spawns, and all stationary queues arm unseen cleanup. Police retain pursuit routing. The 57 focused regressions include all six route graphs in parked/moving/Quick modes, cache/streaming recovery, safe turns, ground contact, passing and visibility. Initial emitted-cell figures are INVALID: their harness omitted runtime's `connected:true` footprint semantics. Preserved originals and matched corrected 21-scenario before/after measurements (including active/spawned/moving fleet counters) are in `.scratch/fix-traffic2/`. Browser comparisons use matching 180-second drives; the original baseline's subsequent brake phase selected reverse and is not valid parked evidence. Final staging browser verification is pending coordinated publication. Isolated visible traps at genuine road gaps, buildings or a blocked lane can still wait until unseen; this change does not remove cars while the main camera or mirrors render them. Quick modes configured with zero civilian traffic and Megara's closed circuit are reported separately and do not prove traffic flow.

(Move items here with the PR or commit that fixed them.)
