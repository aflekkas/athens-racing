# Handover to the bake agent: Athens world dressing (2026-10-19)

Everything is on `prod` in three commits (`590fb520` ground, facades, sea; `c7fdab54` traffic signals; the third commit adds the street details). Nothing was baked into the shared world, published or pushed. **The next full bake includes all of it.** Docs: `docs/world-dressing.md`.

## What to rebake

**Every cell.** The new data is in every cell's metadata, so no cell hash survives:

| change | where | needs a rebake? |
|---|---|---|
| seven ground colours (grass, forest new; earth, sand, rock, scrub recoloured), steep ground over 0.42 is rock, parks | `appearance.py`, `tiles.py` | yes: vertex colours |
| facade style per building | `tiles.py` -> `worldDetail.buildings.facadeStyle` | yes (without it the runtime picks a style by height and building id) |
| shore foam strip mesh (`tileSurface: foam`, `aFoam`) | `tile_detail.foam_mesh`, coastal cells only | yes |
| traffic signal heads | `worldDetail.signals` | yes |
| street furniture rows | `worldDetail.props` | yes |

Old cells still render (ground and sea get their layers from run-time tagging, buildings get facades from derived data), but without foam, signals, props, the new classes and the building types. A tile whose manifest `residentBytes` was baked before this is accepted (the runtime allows for the facade attribute it adds).

## Commands: unchanged, plus one cache

The bake commands in `docs/world-areas.md` are unchanged (`build-coast.mjs CACHE OUT AREA`). The generator needs three source files in the cache directory, all named in `areas.py` `SOURCES` (so every area file inherits them):

* `building-details.sqlite` (`details`): already in the cache; now read for the facade style.
* `vegetation.sqlite` (`vegetation`): already read for trees; now also its `areas` table (park polygons) colours parks green.
* **`street-nodes.sqlite` (`street_nodes`): NEW.** Already built and placed in `/home/dev/data/athens-world-cache/` (6.5 MB, with `.sha256` and `.metrics.json`), from the pinned full Greece source (hash checked, then deleted again). To rebuild it: fetch `greece-261014.osm.pbf` into the cache with `fetch.py`, then `venv/bin/python tools/world-gen/street_nodes.py $CACHE/greece-261014.osm.pbf $CACHE/street-nodes.sqlite` (2.7 minutes), then delete the source. Building it from `attica.osm.pbf` alone works but finds only the nodes that belong to ways (all signals and stop signs, almost no benches, kiosks or bus stops).

The generator code hash and the three source hashes are part of the bake revision, so the revision changes by itself.

## Merge notes (tools/world-gen is shared)

Edits to existing generator files are additive: `appearance.py` (new classes and `ground_category`), `tile_detail.py` (three new functions), `tiles.py` (the `park_areas` line after `Field(...)`, an `extra` parameter on the local `mesh()`, the foam call after the water mesh, `facade_styles` for `facadeStyle`, the raw-tag loop also collecting `lit` and `parking` tags, and one block that calls `props.build` before the validation lines), `areas.py` and `build-coast.py` (two source names). New files: `props.py`, `street_nodes.py`, `dressing_test.py`, `props_test.py`, `*.test.mjs`. `bake(...)` gained two keyword parameters at the end (`details`, `street_nodes`); a call without them still works and then emits no signals or props.

A bake of a **subset** (`ATHENS_CELLS`) must include the spawn cell (4,25), or `build-coast.mjs` stops with "No validated Glyfada spawn".

## What the gates saw

The 16 test cells (Syntagma, Plaka, Kypseli, Glyfada coast, Piraeus port) were baked with the full gates on (asphalt <= 30 degrees, 15 cm step, exact seams, contacts, bridge clearance): all passed; only vertex colours, extra meshes and extension arrays changed, never a position. Worst 2x2 safety set of the test bake: 13.1 MB.

## Cost per cell (test cells, against step 1)

Textures: one 256 px RGBA noise texture, 0.33 MB (limit 3 MB). Compressed: facades and foam +1.1 to +5.4 KB (+0.4% to +1.3%), signals and props another +0.04 to +6.8 KB. Resident: facades +1% to +9.5% (the `aFacade` vertex attribute, 4 bytes a vertex of every building), signals and props +0.1% to +0.3%. Dense cells therefore grow by 6 to 10% resident; the 64 MiB stream cap holds proportionally fewer of them. **Option to win it back, needs the owner's say:** the derived building meshes carry three identical shade bytes per vertex (`color`); one derived value in the shader would save 3 of the 4 bytes, but `tools/world-tile-compact.test.mjs` pins the derived colours. Draw calls (Syntagma, Plaka, Kypseli, Piraeus views): +7.1%, +2.0%, +4.1%, +6.9% with World detail On, 0 with Off.

## Not done

Pedestrian-street paving (`highway=pedestrian` ways are in neither the road tables nor the node cache), pedestrian signal phases, queueing behind other AI cars. Kiosk and bench counts are whatever OSM has (about 20 and 140 per km² in the centre test cells). Trees remain the existing vegetation layer (<= 96 a cell).
