# Athens generator — offline foundations

This is an extraction/cleaning milestone, not a playable Athens release. No
stage-A manifest, runtime activation or hosting size claim is included.
The Glyfada images are a single-cell geometry probe, not a playable-world pass.
Credits screenshots are attribution evidence only.

## Sources and disk

- Pinned Greece PBF: 341,944,784 bytes; SHA-256
  `7087cf00b0e47833c40837b9ee7cc5c3020420decc3980406d3b8f0b5d62a6f3`.
  Deleted after verifying the reduced extract.
- Reduced Attica PBF: 62,333,978 bytes; SHA-256
  `db17fa15807d29f115bd160937e34194255e8b6e61148ccb90dc19a0ef25dc15`.
- Cropped DEMs: 8,591,272 + 17,292,644 bytes. Original degree TIFFs deleted.
- Retained raw total: **88,217,894 bytes** in `/tmp/athens-world-cache`.
  Python environment and derived SQLite caches are separate from this raw total.
- Reduced extract: 8,271,469 nodes, 827,468 ways, 9,978 relations.
- Source gaps explicitly recorded: one absent referenced node, 3,638 unavailable
  relation-member ways, 12 discarded incomplete relations. No present selected
  way was discarded. Full missing/discarded IDs are in `attica.osm.source.json`.
- Extract elapsed 2,463.583 seconds includes interruption/resumption; recorded
  peak RSS 225,501,184 bytes describes the resumed invocation only.

Only the reduced PBF receives a node-coordinate disk index. At most two private
repo archives are used, both sharing the existing node_modules symlink. No raw
OSM/DEM or derived regional database is committed.

## Reduced-extract ingestion

Completed in 1,098.260 seconds, peak RSS 319,578,112 bytes, SQLite
309,506,048 bytes. The wide extract contains 450,582 building entities,
184,351 drivable road ways, 25,362 landuse areas, 11,600 natural landcover areas,
1,688 coastline ways and 795 water areas. These are not per-stage counts.
Six invalid areas and five unassembled/outside building relations are recorded.
See `ingestion.json`; source gap IDs remain in the extraction provenance.

## What the focused checks establish

- Deterministic reduced PBF and SQLite outputs on a complete small OSM fixture;
  reference pruning is explicit and cached sources are hash-checked.
- Access/one-way/layer preservation, shared-node graph splitting, tagged heights,
  DEM interpolation/coverage failure, stable distinct building/terrain palettes.
- Actual footprint walls/roof, concavity and simple courtyard preservation;
  total entity budget <=40 triangles, clockwise AWT corners, upward roofs.
- Shared profile grade/clearance constraint solving; infeasible constraints fail.
- Adjacent planar terrain fixtures have complete area, manifold edges and equal
  border heights. This does not establish real-road conformance.
- The AWT packer uses the shared codec and validator on every input/output tile;
  cracked adjacent fixture tiles cannot publish an entries index.

`credits-1280.png` and `credits-390.png` were captured using the real Menu/Credits
components through the browser slot, then visually inspected. Text is readable,
with no horizontal overflow. `credits-browser.json` records no browser errors.
These are not world screenshots. `dem-samples.json` contains source DSM samples,
not surveyed road heights. `riviera-anchor.json` records a nominal existing
Riviera start sample; it is not a validated world spawn/contact join.
`riviera-road-match.json` shows that this nominal sample sits between the two
OSM carriageways, so it must be moved onto a validated lane before use.

## Release work still required

Real global profiles and full bridge/tunnel footprint clearance; road ribbons,
junctions, kerbs, markings, structures and signs; terrain conformance/contacts;
AWT region generation/packing and per-tile acceptance; Riviera connection;
streaming runtime menu/GPS/tow/traffic; staged hosting measurements and inspected
world views. Stage reports must keep tile count, largest tile and geometric
validation as unavailable until those actual outputs exist.

## Real-data geometry probe (not playable)

`probe-glyfada-overview.png`, `probe-glyfada-street.png` and
`probe-glyfada-junction.png` show AWT cell (4,25),
near Laodikis in Glyfada. All were inspected: white/light buildings contrast
with urban grey and earth ground; no vegetation props. The preview uses unlit
basic materials with no effects. It has 233 building parts, 70,576 drawn
triangles and 13 draw calls; `probe-browser.json` records no browser errors.
The underlying terrain partition covers 262,144 m² with 52,918 triangles.
The shared AWT structural validator passed both before and after encoding.
These measurements are a first probe, not a before/after performance claim.

The revised probe has baked building-face shading, lane/centre markings,
contrasting pavement and 10 cm raised kerbs. The same overview/street cameras
are preserved in `before-style-*`; cost rose from 38,102 to 70,576 triangles
and 9 to 13 draws, with unchanged building triangles. The added cost buys the
requested detail; this is not a performance optimization. The label now has an
explicit UTF-8 charset; the generator/harness contain no mojibake markers.

The probe omits structures, graph/anchors, raised pavement contacts and neighbouring
tiles. Its Float32 terrain layout is provisional. It does not establish road
conformance, dependency completeness, seams to real neighbours or playability.
The prototype and browser harness are retained here for inspection; inputs stay
in the single external cache. No manifest was emitted.

The south profile experiment contains 32,102 road parts, 287,556 sampled points
and 144 layered centerline crossings. Local iterative relaxation left a
0.1287 m grade violation after 2,000 sweeps; balanced difference envelopes
reduced the maximum violation to 8.24e-14 m in 4.57 seconds of solving. The
largest seed-height adjustment was 8.35 m. Full surface/deck clearance and
road-level survey accuracy are not established by these constraints. This
probe reused the sampled inputs; a fresh end-to-end regeneration completed in 478.91 seconds with peak RSS
190,337,024 bytes. All roads, points, samples, constraints and crossings exactly
match the probe database (`profiles-a-fresh.json`). The experimental road-only
input still needs comparison with the completed regional clean database.
See `profile-solver-check.json` for exact numbers and solver hash.

The styled probe gzip is 1,754,577 bytes (6.69 MB/km² at this single dense cell).
This provisional Float32 layout exceeds the AWT planning density target and
must not be used to promise full-stage hosting/residency sizes. Compact shared
terrain buffers, final contact integration and region packing remain required.
`probe-cost.json` separates mesh/table storage to guide that work.

## Public topology audit

`connectivity-a.json` finds a directed 8,115.422 m / 109-edge path from
`w459160388:0:f` near Riviera to `w24826358:0:f` in Glyfada. It audits 46,257
public directed edges from the 32,102 sampled road parts, compiles 551 node
restriction relations, conservatively forbids entry into 264 via-way connectors,
and excludes 69 directed edges affected by 20 unsupported restriction relations.
The conservative exclusions reduce coverage; they are not exact via-way routing.
This is a bounded stage-A topology experiment, not an exported graph or runtime
integration. Rendered road/contact continuity and the legacy Riviera join remain
unvalidated. `riviera-profile-anchor.json` is only a candidate lane/profile
position and must not be used as a spawn before those checks.

## Lossless packing follow-up

Identical table buffers now share indexes and all arrays use the existing
shared codec's byte planes. The same styled cell is 1,380,077 gzip bytes
(21.34% smaller), with 3,968,156 retained CPU array backing bytes (7.98% smaller).
All decoded table/mesh bytes are unchanged. All three captured PNG pairs are
byte-identical and were visually inspected. Draws/triangles remain 13/70,576.
See `packing-comparison.json`, `packing-worker-check.json`,
`packing-image-comparison.json` and the linked performance report. The density
is still above the planning target; no whole-stage hosting claim follows.
