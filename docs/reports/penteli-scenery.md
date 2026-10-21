# Penteli Mediterranean scenery pass

Penteli's attached region replaces the beige mountain appearance with mapped
woodland, maquis, exposed limestone/marble and quarry scars. The existing OSM
extraction supplies 32 woodland, 56 scrub, 17 rock, eight quarry and 39 residential
polygons. Quarry/rock tags take precedence over woodland. Untagged unbuilt land
uses dense Mediterranean pine defaults. Tagged scrub retains openings and smaller
regrowth; this is not a surveyed fire-history layer.

The region contains 170,122 cell-owned pines and 97,551 maquis
placements. Beyond 200 m, up to 6,000 camera-facing pine crowns fill the slopes
from the existing regional terrain grid, in the same instanced batch. Four
jittered crowns per 32 m square make a continuous mid-distance canopy, while
mapped quarries, bare rock and road corridors remain open. The forest uses a
byte mask and interpolates existing terrain positions instead of retaining a
second world-sized object list. Its additional memory is explicitly reserved.

The village frontage has inferred houses, four tavernas with striped awnings
and terrace tables, and stone walls. Along with residential infill, it totals
87 houses, four tavernas and 28 walls. These are procedural interpretations,
not surveyed building footprints. Existing mapped buildings and chapel geometry
remain. One instanced 30-triangle architectural kit extends the Riviera hipped
roof and facade recipe; extra parts collapse for houses and walls. Pines reuse
its irregular crown model. Rounded olive maquis clumps reach the shoulder.
The old box-tree detail records are removed, avoiding duplicate vegetation.

All cell-owned plants and architectural foundations are sampled against the
emitted fine terrain, with no coarse/DEM fallback beyond its footprint. The
post-bake audit checks every decoded root and foundation, and enforces at least
4 MiB of 2×2 headroom. Roads and building bounds stay clear; optional house and
wall colliders belong to their cells and are disabled with World detail Off.

All added objects are instanced, with bounded near/far batches. Landcover is one
byte per terrain vertex, including the shared regional background. Steep faces
and mapped quarries receive pale marble cuts and grey rock shading; the mountain shader disables
inferred sand. World detail Off hides all added instances, restores the original
terrain colour and disables the optional obstacle index. Lighting Off + Effects
Off remains the only look. No new textures are allocated.

## Verified world-data gates

The 225 cells retain every original physical table byte-for-byte: road and fine
terrain contacts, graph edges/turns, safe anchors and building footprints. The
old route is covered at **5,241 / 5,241** samples across 21 drivable cells.

- Asphalt maximum **29.697°**; profile maximum **39.153%**.
- Maximum shoulder step **14.164 cm**.
- **420** shared boundaries and **989,233** contact samples; no missing contacts
  or seam failures. Maximum boundary delta **1.541 cm**; transition **14.604 cm**.
- Both OSM bridge ranges pass the unchanged layered deck/guard audit. Neither
  range crosses a drivable underpass, so underpass clearance is not applicable.
- **30 / 30** streamed nearest-road tow scenarios pass, with no fall or launch.
- Worst 2×2: **62,027,806 bytes (59.15 MiB)** including the shared background and
  explicit scenery-record reservations; **4.85 MiB headroom** under 64 MiB.
- Penteli compressed: **30,456,841 bytes**. Composed world: **417,407,699 bytes**,
  1,676 cells, below 2 GiB.

At matched village, hairpin, chapel and upper-road viewpoints, added scenery
peaks at **+9.30% draw calls** and **+7.08% triangles**, under +10% / +25%.
The comparison toggles only the added instance groups on the same resident cell
set, avoiding differences caused by streaming admission. Full before/after views
also use matched absolute poses. These are software-renderer counts, not a
physical-device FPS claim. World detail Off leaves zero added visible instances
and disables detail collisions.

The Syntagma, Psychiko and Riviera route proofs retain their exact accepted
corridor subset and record hashes. A fresh capture across 123 verified basin halo
cells confirms all 6,400 contact queries are identical; all existing widths fit
inside the new proof. Rebinding the previous proof to the new world-set revision
avoids widening 250 queries due to the concurrent Riviera road-width change.
All 43 referenced source cells are unchanged. All three routes validate with
identical geometry and route hashes. This pass adds no Penteli race definition.

## Staging artifact and reproduction

World-set revision:
`dd98d7bac13833eca19e0f583d6da49cd332df8cd6de3b84a1c72df4aaa8961d`.

Manifest:
`manifests/7de3a7d423f14780d906fa9af913325a8a0f0bf39bfbdc303ed349c2ea7d80d3.json`.

Only `athens-racing-world-staging` receives these immutable objects. The preflight
inventory is 2,765,449,360 bytes; this pass adds 30,547,205 bytes for a projected
2,795,996,565 bytes, below the 5 GB staging limit. The
activation commit is gated by a clean candidate archive's locked full `npm test`,
physics regression, browser-import and syntax checks. Production remains held.
No cells are committed. The existing mixed-datum isolation rules still apply:
basin EGM2008, Penteli EVRS2000, no shared boundary or portals.

```sh
node tools/import-track-region.mjs TASK_OUT BASIN_MANIFEST
# The importer intentionally stops before acceptance until gameplay is proved:
node tools/accept-track-region.mjs TASK_OUT
node tools/audit-penteli-scenery.mjs TASK_OUT
PENTELI_CAPTURE_SPOTS=village,hairpin,chapel,upper \
  tools/browser-slot.sh node tools/penteli-region-capture.mjs TASK_OUT FEED after
```

The source lock in `tools/world-gen/regions/penteli.json` covers the importer,
source map/DEM and runtime dependencies. Refresh it explicitly with
`node tools/import-track-region.mjs --lock-sources` only after reviewing changes.
`tools/penteli-scenery.test.mjs` covers landcover precedence, cell ownership,
road exclusion, grounded distant canopy, instancing, eviction and the detail toggle. AWT tests reject malformed
scenery rows and understated record reservations.

Evidence is retained in `/home/dev/data/agent-feed/penteli/` as
`scenery-before-*.webp`, `scenery-after-*.webp`, `scenery-coverage.webp`, matching
captions, `scenery-equivalence.json`, `scenery-physical-equivalence.json` and
`scenery-render-checks.json`, `scenery-grounding.json`. Final R2 inventory and release status accompany
those files. All images are 1280×800 and below 150 KB.

Road/landcover data: © OpenStreetMap contributors, ODbL 1.0, from the existing
attributed Penteli bundle. No third-party photographs or map tiles are included.
