# Streamed Athens: ground, facade and sea textures (World detail)

Everything here is behind `?map=athens` and is **procedural**: made in code at load time, no image files, no per-building or per-place cases. It is the owner's 2026-10-19 feedback answered ("building textures, i cant see any texture", "nor does the sea have texture", "the ground could have at least a texture"), under the same locked look as the rest of the game: unlit colour only, no lights, shadow maps, reflection or refraction pass, no post effects. Shaders and the noise texture: `src/athens-detail.js`; materials: `src/athens-materials.js`; guards: `tools/athens-detail.test.mjs`, `tools/world-gen/dressing.test.mjs`.

## One shared texture

A single 256 × 256 RGBA noise texture (`buildNoise`, built at first use in about 20 ms, uploaded once) feeds every pattern: **R** fine grain, **G** mid blotches, **B** low-frequency patches, **A** ridged lines (cracks, wave crests). It is 0.33 MB with mips. That is the whole texture budget of the dressing (limit: 3 MB). All patterns read it at scales whose periods divide the 512 m cell (16, 4, 1.28, 128, 512/3 m and so on), so tile-local UVs continue across tile borders exactly like the road scans do; `tools/athens-detail.test.mjs` checks every divisor in the shader source. Low-frequency layers use two incommensurate scales, so a repeat is not visible.

## Ground (by OSM land class, soft borders)

The bake already colours every ground vertex by its land class; the classes and colours are `TERRAIN` in `tools/world-gen/appearance.py`, mirrored by `GROUND_CLASS_COLOURS` in `src/athens-detail.js` (a test fails if they drift). The shader recovers soft weights from the *interpolated vertex colour* (chroma and log brightness, so the bake's ±6% variation never changes the class), so a boundary between two classes is a smooth blend and costs **no bytes per cell**. A cell baked before the dressing still gets the textured ground, because `world-tile-dressing.js` tags the ground and sea meshes at run time.

| class | OSM | pattern |
|---|---|---|
| urban | landuse commercial, retail, industrial, garages, railway | paving joints every 2.56 m, grain, stains (existing paving scan stays on all-urban triangles) |
| earth | residential and the default | gravel pebbles, blotches, warm/cool drift |
| grass | `leisure=park`, garden, pitch, `landuse=grass`, meadow, cemetery, `natural=grassland` | patchy greens, dry yellow patches, blades |
| scrub | `natural=scrub`, heath, orchard, olive grove, farmland, vineyard | dark bush dots over dry earth |
| forest | `landuse=forest`, `natural=wood` | dark needle litter, mottled |
| sand | `natural=beach`, sand, low flat land within 35 m of the coast | fine grain, stretched ripples |
| rock | `natural=bare_rock`, scree, slope over 0.42 (was 0.55), height over 900 m | cracks, strata, blotches |

`leisure=park` polygons are not in the landuse table; the generator reads them from the vegetation cache's `areas` (`tile_detail.park_areas`), so no new cache is needed. Contrast fades with distance (160 to 360 m) and mips do the rest.

## Buildings (facade rhythm per floor, from the footprint tables)

Facades are drawn by the building shader from two numbers per vertex, derived at load time in the tile worker (`world-tile-buildings.js`, nothing extra on the wire): the distance along the wall and the height above the base (`aFacade`, two Uint16, plus the facade style). Per 3.05 m floor and per bay: window openings with sills and frames and varied glass (open, curtained, shuttered), balcony slab and railing bars with a handrail (style 1 and 3), shutters (2), awnings (3), a shop band with sign board on the ground floor (4, and some ground floors of 1 and 3), continuous glazing ribbons (5), stone courses (6), corrugated sheet and a high window band (7), a door every third bay otherwise. Roofs get a darker concrete texture. Colour variation is the existing per-building palette shade. Thin bars fade with `fwidth` so nothing shimmers.

The style is `facadeStyle` of the tile's `worldDetail.buildings`, which the generator now fills from the existing `building-details.sqlite` (OSM building type: apartments 1 to 3, shop 4, office 5, masonry 6, industrial 7). Style 0 means "unknown", and then a rule on height and a hash of the **whole** building's id (so the pieces of one building in two cells agree) picks: low houses shutters or plain, mid-rise balconies, awnings or shops, tall blocks balconies with a shop floor or offices.

## Sea

`tileSurface: 'sea'` (the `water` mesh): two scrolling ridge layers at different scales and directions (64 m and 85 m periods, opposite drift) over slow deep/shallow patches, plus a faint glitter layer. **Colour only**: no reflection, no refraction, no depth pass. The clock is `SEA_TIME`, set by the render loop. Because every tile scrolls identically in tile-local UVs, tiles never seam.

Shore foam is a separate strip mesh the generator emits per coastal cell (`tile_detail.foam_mesh`, `tileSurface: 'foam'`): the water polygon within 6 m of the coastline (not of the cell edge), with `aFoam` 1 at the shore and 0 at 6 m (one Uint8 per vertex). The shader discards below a moving swash threshold, so the foam is opaque and needs no blending.

## World detail On / Off

Every layer reads the shared `uWorldDetail` uniform. Off draws the plain palette colour (old look); the foam strip's material is hidden, so its draw call goes too. What Off does **not** remove: the 0.33 MB noise texture and the `aFacade` vertex data stay resident (measured below). The `aFacade` data is the main cost; dropping the unused `color` attribute of derived buildings (three identical bytes per vertex, 3 B) and computing the wall shade in the shader would pay for it, but it changes the guarded derived-building mesh (`world-tile-compact.test.mjs`) and needs the owner's say.

## Cost (12-cell test bake, centre / Piraeus / Glyfada, `.scratch/athens-world-dressing-2026-10-19/step1/`)

* Textures: +1 (0.33 MB). Draw calls: unchanged in every measured view (113 / 153 / 122 / 130 with detail On; Off 1 to 2 fewer); +1 foam call in a coastal cell with detail On. Triangles: unchanged except the foam strip (+0.3 to 1.2k in Piraeus).
* Bytes per cell: compressed **+1.1 to +5.4 KB** (+0.4 to +1.3%: facade styles, foam strip, the new colour classes); resident (CPU arrays + GPU copy, the number in the manifest) **+1% to +9.5%** per cell (dense cells most: -1,0 +333 KB of 3.6 MB). With nine cells around Syntagma resident: tile JS 6.59 to 7.54 MB, tile GPU 4.12 to 4.80 MB.
* Frame cost: the ground shader does five texture fetches, the building shader one (plus procedural maths), the sea four.

## Source data

No new cache for textures. Uses `vegetation.sqlite` (park polygons) and `building-details.sqlite` (building type), both already in the cache directory; `areas.py` now lists `details`. A bake needs nothing else for this layer.

## Traffic signals (working, instanced)

Every OSM `highway=traffic_signals` node of the Athens world is a signal. Nodes within 35 m of each other are one junction. For each drivable edge that ends within 25 m of a junction's signal nodes, the generator (`tools/world-gen/props.py`) emits one **head** at the edge's stop line (9 m before the junction node), on the right-hand kerb (carriageway half-width + 0.85 m), facing the approaching traffic. A head is one row of `worldDetail.signals` (x, y, z, yaw, phase offset, phase group: 24 bytes, plus the 4-byte id of the edge it controls). Edges clipped at a cell border are handled by the cell that owns the edge's end.

**One plan per junction, shared with the Riviera.** The fixed-time plan is `src/signal-plan.js` (28 s: main road green 16, amber 3, red 9; cross traffic goes during the main red), which `src/signals.js` now imports too. The group is the approach axis (north/south approaches are group 0, east/west group 1, so opposite directions run together); the **green wave** is the junction's offset, `-northing / (80 km/h)` mod 28 s, so cruising north/south at 80 km/h meets green lights in sequence and anyone faster meets red.

**Drawing.** One instanced mesh per model in view (`src/athens-props.js`, shared with the street furniture, below): the signal mesh is a pole, short arm, head housing, backplate and three lamps; each head's lit lamp is its instance `iState`, rewritten only when its phase changes (a few times per cycle, not per frame). Per frame the cost is one phase calculation per head in range (at most 240).

**AI traffic** (`AthensProps.hold`, used by the traffic loop in `athens-world.js`): a car on a controlled edge stops when the signal is red or amber and it is between 5.5 and 9.9 m before the end of the edge (the stop line), and carries on when green or once past the line. **The player is never forced to stop.** With World detail Off the lights are not drawn and AI traffic ignores them (an invisible red would look like a bug). Evidence: `.scratch/athens-world-dressing-2026-10-19/step2/signals-ai.json` (a car released 40 m before a real stop line holds at 9.1 m while red, goes on when the clock turns green, never holds on green, and ignores the signal with detail Off).

Not modelled: pedestrian phases or heads, turn arrows, flashing amber, detector-actuated plans, and a per-junction axis (an arm at about 45 degrees to north can fall in either group). Cars do not queue behind each other (the Athens AI has no car-following).

Counts, 16 test cells: **194 heads** (Syntagma cell 25, Kypseli 33 + 20, Piraeus 11 + 5 + 9), about 95 per km² in Syntagma. Cost: 24 + 4 bytes per head, so a Syntagma cell +0.7 KB resident; draw calls: +1 per signal model in view (the heads are one call).

## Street nodes cache (new)

`tools/world-gen/street_nodes.py ATTICA.osm.pbf OUT.sqlite [SUPPLEMENT.osm.pbf ...]` streams the pinned Attica extract (way-complete: all signal and stop-sign nodes, which belong to ways) and writes `street-nodes.sqlite` (kind, x, z, tags in world metres; 1.9 MB, 2 minutes). `areas.py` lists it as `street_nodes`; `build-coast.py` passes it to the cell bake. Isolated nodes (benches, kiosks, many lamps and bus stops) are mostly missing from a way-complete extract; the optional supplement is the same trick `vegetation-nodes.py` uses for trees (re-fetch the full Greece source, keep only tagged nodes).

```sh
CACHE=/home/dev/data/athens-world-cache
$CACHE/venv/bin/python tools/world-gen/street_nodes.py $CACHE/attica.osm.pbf $CACHE/street-nodes.sqlite $CACHE/attica-tree-nodes.osm.pbf
```

## Street details (instanced, from OSM)

Everything below is a row of `worldDetail.props` (x, y, z, yaw, variant as Float32, plus one Uint8 kind: 21 bytes per prop), placed by `props.py` from `street-nodes.sqlite` and road tags, kept off buildings (0.5 to 1.4 m clearance) and inside the cell. **One instanced mesh per model in view** (`src/athens-props.js`): at most one draw call per model, none for a model with nothing in range, in total one nearest-first pool of 900 instances. Each model has its own range (`PROP_NEAR`): lamps 210 m, signals 230, bus stops and kiosks 140, fountains and monuments 160, parked cars 120, signs 100 to 110, benches and bollards 80, so a street scene shows a handful of models. Models are unlit coloured boxes: street props 12 to 120 triangles (signal head 132, fountain 120), signs at most 48. World detail Off hides the layer and builds nothing. Draw cost is per model in view, not per tile or per prop.

| model | OSM source and rule | triangles | per km² in the centre test cells |
|---|---|---|---|
| street lamp | `highway=street_lamp` nodes, and every 42 m (alternating sides) along `lit=yes` roads of class residential or larger | 36 | 151 |
| bench | `amenity=bench`, `leisure=picnic_table` nodes | 48 | 142 |
| kiosk (periptero) | `shop=kiosk`, `amenity=kiosk` nodes | 36 | 20 |
| bus stop, bus shelter | `highway=bus_stop` (or `public_transport=platform` + `bus=yes`) nodes; a shelter if `shelter=yes`; moved to the kerb of the side of the road it is on | 24, 60 | 3, 20 |
| pedestrian-crossing sign | `highway=crossing` nodes (not `crossing=no`), 3 m before the crossing on the right kerb of each approach | 48 | 36 |
| stop and give-way sign | `highway=stop`, `highway=give_way` on the least important road that ends at the node (all arms if equal), 4.5 m before it; never at a signal | 36 | 11 (stop) |
| one-way sign | edges with `oneway`, 7 m after their start, half of them by a hash of the edge id; not at a signal | 48 | 50 |
| bollard | `barrier=bollard` nodes | 12 | 3 |
| fountain, monument | `amenity=fountain`; `historic=monument` or `memorial` nodes | 120, 36 | 3, 17 |
| parked car | edges with `parking:lane:left/right` in parallel, diagonal, perpendicular, marked or yes: a car every 6.5 m on 55% of slots, six paint colours through the instance colour | 72 | 0 in the centre, 172 over the three Piraeus cells |
| trees | existing `worldDetail.vegetation` (OSM trees, tree rows and park samples), unchanged | n/a | 153 |
| traffic signals | see above | 132 | 68 |

Density is the six centre test cells (Syntagma, Plaka, Kypseli; 1.57 km²). OSM is the limit: nothing here is invented, so a district with few tagged benches has few. Not done: pedestrian-street paving (`highway=pedestrian` ways are not in the road tables or in the node cache; a pedestrian mesh needs the ways from the extract), awnings and cafe tables, kerb ramps, street signs with names, trees beyond the existing vegetation layer.

### Where the nodes come from

A way-complete Attica extract has only the nodes that belong to ways, so it lacks most benches, kiosks, bus stops and lamps (3 kiosks and 19 benches in the whole region). `street-nodes.sqlite` is therefore built from the pinned full Greece source (`greece-261014.osm.pbf`, 342 MB, hash-checked; delete it afterwards as `vegetation-nodes.py` says), 6.5 MB, 2.7 minutes: 11,824 crossings, 8,814 bus stops, 8,257 stop signs, 6,760 benches, 5,532 signals, 5,095 lamps, 1,173 kiosks, 608 monuments, 517 bollards, 276 give-way signs, 200 fountains. The cache in the shared cache directory is this full one.

```sh
CACHE=/home/dev/data/athens-world-cache
# fetch the Greece source into the cache once (tools/world-gen/fetch.py), then
$CACHE/venv/bin/python tools/world-gen/street_nodes.py $CACHE/greece-261014.osm.pbf $CACHE/street-nodes.sqlite
```

### Cost, 16 test cells (compared with the bake of step 1)

* Compressed **+0.04 to +6.8 KB per cell** (+0.1% to +1.8%: signals, props and the kind column), resident **+0.2 to +12 KB** (+0.1% to +0.3%). Dense cells hold 100 to 400 rows (2 to 8 KB raw).
* Draw calls and triangles in the dense views, whole layer (signals + details) On against the step-1 tree, `step3/measure.json`: Syntagma 113 to 121 calls (+7.1%), triangles +12.5%; Plaka 153 to 156 (+2.0%), +0.4%; Kypseli 122 to 127 (+4.1%), +2.6%; Piraeus 130 to 139 (+6.9%), +5.0%. With World detail Off: unchanged in all four (the layer builds nothing).
