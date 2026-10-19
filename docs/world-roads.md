# Generated roads: one cross-section model, derived from OSM

Owner, 2026-10-18: *“all auto generated roads should be textured and have sidewalks and the same width,
this should not be something we have to manually do … we should be able to map this stuff out from the open data.”*

Every street in the streamed Athens world (`?map=athens`) is drawn from one record, the **road section**,
computed per OSM road by `tools/world-gen/road_section.py` from its tags, with a documented default for
every missing tag. Nothing is hand-tuned per street. The hand-tuned maps (Riviera, Penteli, Megara,
Psychiko) are untouched.

```
OSM tags ──► road_section.cross_section() ─┐
footway=sidewalk ways ─► sections.py snap ─┼─► sections-*.sqlite (one JSON section per road part)
highway=crossing nodes / footway=crossing ─┘            │
                                                        ▼
                         tiles.py: street_regions.py (asphalt, fillets, kerb, sidewalk, flush zones, lift)
                                   street_details.py (lane / centre / edge lines, zebra bars)
                                                        │
                                  AWT cell: asphalt / paving / kerb / marking meshes + `roadSections`
```

## What a section holds

| field | meaning |
|---|---|
| `class`, `surface` | highway class (unknown → `road`); `asphalt`, `concrete`, `paving` (sett, paving_stones, cobblestone…) or `unpaved` (gravel, dirt, compacted…) |
| `width`, `lanes`, `lanesForward/Backward`, `laneWidth` | carriageway, kerb to kerb; always inside the class band |
| `sidewalk.left/right`, `sidewalkSource` | metres (0 = none) and where it came from: `tag`, `mapped` (a footway snapped to the street), `class` (default) or `none` |
| `kerb` | rise in metres (0.12 when any sidewalk exists) |
| `markings` | `centre` (`none/dashed/solid/double`), `lane` (`none/dashed`), `edge` (`none/solid`), `dash` = [dash, gap] metres |
| `crossings` | `[station, x, z, marked]` from `highway=crossing` nodes and `footway=crossing` ways |
| `parking`, `lit`, `maxspeed` | recorded for later; parking and lighting are not drawn |

Sides are the geographic **left/right of the way's direction**, exactly as OSM's `sidewalk:left/right`.

## Defaults table (`road_section.CLASSES`, mirrored in `tools/world-gen/fixtures/road-classes.json`)

| class | lane m | default lanes one-way / two-way | width one-way m | width two-way m | hard band m | default sidewalk (each side) |
|---|---|---|---|---|---|---|
| `motorway` | 3.6 | 3 / 4 | 10.8 | 14.4 | 7.2 – 21 | none |
| `motorway_link` | 3.5 | 1 / 2 | 4.5 | 7 | 4.5 – 10 | none |
| `trunk` | 3.5 | 2 / 4 | 7 | 14 | 7 – 21 | 2 m |
| `trunk_link` | 3.4 | 1 / 2 | 4.5 | 6.8 | 4.5 – 10 | none |
| `primary` | 3.5 | 2 / 2 | 7 | 7 | 6.6 – 17.5 | 2.5 m |
| `primary_link` | 3.4 | 1 / 2 | 4.5 | 6.8 | 4.5 – 10 | none |
| `secondary` | 3.3 | 2 / 2 | 6.6 | 6.6 | 6.2 – 14 | 2.2 m |
| `secondary_link` | 3.3 | 1 / 2 | 4.5 | 6.6 | 4.5 – 10 | none |
| `tertiary` | 3.2 | 1 / 2 | 5.6 | 6.4 | 5.6 – 12 | 2 m |
| `tertiary_link` | 3.2 | 1 / 2 | 4.5 | 6.4 | 4.5 – 10 | none |
| `unclassified` | 3 | 1 / 2 | 5 | 6 | 5 – 8 | 1.8 m |
| `residential` | 3 | 1 / 2 | 4.8 | 6 | 4.8 – 8 | 1.8 m |
| `living_street` | 3 | 1 / 2 | 4.2 | 6 | 4.2 – 6 | 1.5 m |
| `service` | 2.4 | 1 / 2 | 3.2 | 4.8 | 3.2 – 7 | none |
| `road` (any other `highway`) | 3 | 1 / 2 | 4.5 | 6 | 4.5 – 7 | 1.5 m |

Cells with defaults that differ from the table are a bug: `road_section_test.py` pins the table and
the exported JSON, and `tools/world-roads-audit.mjs` checks every baked cell against it.

### Rules, in priority order

**Width.** `lanes` (an integer 1–16) wins: `width = lanes × laneWidth`. With no `lanes` tag, a numeric
`width:carriageway` / `width` / `est_width` (1–60 m) sets the lane count and is used as-is. With neither, the class
default lane count applies. The result is clamped to the class band, so every road of one class and lane count has
the **same width** (the only exception is a tagged width, which is deliberate data). A two-way road always has at least
one lane each way; a one-way road narrower than the class minimum is widened to it (parked cars). Directional
`lanes:forward/backward` give the split; an odd total gives the extra lane to `forward`.

**Sidewalks**, per side: not on `bridge`/`tunnel` (the owner-approved guarded bridge shoulder replaces them) or unpaved
surfaces → `sidewalk:<side>=no|none` → none → `sidewalk=both|yes|left|right`, `sidewalk:both`, `sidewalk:<side>=yes` → present →
a separately mapped `footway=sidewalk` snapped to the street on that side (within 0.4–7.5 m beyond the carriageway edge,
within 25° of parallel, covering ≥ 35% of the street or 25 m) → present → otherwise the class default above.
`sidewalk=separate` with no footway found falls back to the class default. Width: `sidewalk:<side>:width` /
`sidewalk:both:width` / `sidewalk:width` (1.2 – 4 m), else a footway `width`, else the class default. Sidewalks are drawn
beside the kerb, not where the footway was mapped, so streets stay consistent.

**Surface.** `surface=asphalt` (and no tag) is textured asphalt, `concrete` lighter asphalt, `paving_stones`/`sett`/… paving, `gravel`/`dirt`/… a plain
earth colour with no kerb or sidewalk. Paint only exists on asphalt and concrete.

**Markings** (13 cm lines):

| situation | centre | lane dividers | edge lines |
|---|---|---|---|
| one-way | none | dashed between same-direction lanes | solid on `motorway`, `trunk`, `primary`, `secondary` or `maxspeed ≥ 70` (width ≥ 6 m) |
| two-way, 2 lanes, width ≥ 5.2 m | dashed; solid on fast classes with `maxspeed > 50` | none | as above |
| two-way, ≥ 4 lanes | double solid | dashed | as above |
| `living_street`, `service`, width < 5.2 m | none | none | none |

Dash pattern follows `maxspeed`: ≤ 50 → 3 m / 3 m, ≤ 90 → 3 m / 9 m, faster → 6 m / 12 m (default 50, or 80 on motorway/trunk). Forward lanes are
to the right of the centre line (right-hand traffic).
Marked crossings (`crossing=zebra|marked|traffic_signals|uncontrolled|yes`, or no tag) get four 45 cm bars on a 90 cm pitch; unmarked ones only get the kerb drop.

## Geometry (`street_regions.py`)

All regions are global functions of the loaded roads, so neighbouring cells agree exactly, and are snapped to the 2 cm lattice.

* **U asphalt** = every ribbon at its section width plus **junction fillets**: at every node where three or more streets meet, the local
  asphalt is closed with a 4 m (primary and faster) or 3 m radius, so corners are rounded and there is no gap between the
  ribbons. Dual carriageways keep their median (fillets only fill concave corners near a node). Each fillet patch is owned by the
  nearest street so it has a ribbon station and an anchor-safe road polygon.
* **K kerb**: a 30 cm bevel that rises 12 cm (21.8°, inside the owner's 30° / 15 cm shoulder gate), only beside a street with a sidewalk on that side.
* **S sidewalk**: flat at +12 cm, to the section's width, cut by every street's asphalt and kerb (so it stops at side-street mouths).
* **Ramp**: the 12 cm falls back to ground within about a metre (not a separate contour; ground triangles slope by themselves).
* **Z flush zones**: junction fillet corners and crossing rectangles drop the kerb to 12% of its height, blended over 1.2 m (kerb drops).

The rise is added **per emitted vertex** as `lift(x, z) = 0.12 · up(d_asphalt) · ramp(d_sidewalk) · drop(d_flush)`, rounded to 1 mm. Each factor is a clamped
linear ramp, so the lift is continuous and every emitted triangle stays under 30°; contact, render and graph heights all see the same surface.
The 8 m height lattice is untouched, so asphalt keeps the earlier physical proof (zero asphalt triangles above 30°).

## Rendering

Tile meshes carry `userData.tileSurface`: `asphalt`, `paving` or `marking`. `src/athens-materials.js` turns them into unlit materials using the same
shared library scans as the hand-tuned maps (`asphalt_02_diff`, `floor_pavement_diff`; only these two are loaded for Athens, about 0.5 MB) with
**planar UVs taken from the tile-local position**: 512 m is exactly 122 asphalt periods (4.197 m, the maps' 4.2 m) and 160 paving periods (3.2 m), so
the scan never seams at a cell border. Markings use `polygonOffset` so 1.5 cm paint never z-fights. Kerbs are a plain light concrete colour.

## Gates

* `tools/world-gen/road_section_test.py` (pure Python): tag combinations incl. missing, garbage and unknown values; every class × lane × width × oneway × surface combination stays
  in its band; all 215 distinct tag combinations of the 1,744 real coast roads (`fixtures/coast-road-tags.json`); sidewalks present where tagged or class default;
  marking rules; the exported table.
* `tools/world-gen/street_regions_test.py` (shapely): regions disjoint, reach fully covered, rounded T-junction without holes, dual-carriageway median kept, lift gradient < 30° everywhere, kerb drops at corners and crossings, zebra bars, paint stays on the carriageway.
* `street_audit.py` runs on **every baked cell**: no overlap of asphalt/kerb/sidewalk/ramp (>3 cm), no gap in junction asphalt, ≥ 99% of sidewalk samples present.
* `tools/world-roads-audit.mjs` runs on every packed cell (`pack.mjs`): class band, lane/sidewalk sanity, one width per class+lanes, paving and kerb meshes where sidewalks exist.
* The earlier conformance gates still run unchanged: no asphalt > 30°, 6 m shoulder sweep (step ≤ 15 cm, ≤ 30°), seams, road level, tow-on-road, bridge clearance.

## Regenerating

```sh
CACHE=/home/dev/data/athens-world-cache   # the same cache as the rest of world-gen; nothing is downloaded
$CACHE/venv/bin/python tools/world-gen/sidewalks.py $CACHE/attica.osm.pbf $CACHE/sidewalks.sqlite        # ~3 min, once
$CACHE/venv/bin/python tools/world-gen/sections.py $CACHE/profiles-a.sqlite $CACHE/source.sqlite $CACHE/sidewalks.sqlite $CACHE/sections-a.sqlite   # 20 s
node tools/world-gen/build-coast.mjs $CACHE <output-dir>
python3 tools/world-gen/road_section.py > tools/world-gen/fixtures/road-classes.json   # after editing CLASSES
```

Neither `sidewalks.sqlite` nor `sections-*.sqlite` is shipped or committed; only baked cells are, and they carry per-road section rows in `metadata.roadSections`.

## Known limits

Parking lanes, street lights and trees are not drawn. Sidewalks follow the street, not the building line, and run under buildings that stand on them.
A footway mapped as a long separate path far from any street is ignored. Roundabout islands are not modelled. Class defaults apply everywhere, including
rural streets without houses (OSM has too little sidewalk data to tell them apart).
