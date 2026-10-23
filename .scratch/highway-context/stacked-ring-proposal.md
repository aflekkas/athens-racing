# Kifisias interchange: bounded policy proposal, not activated

## Decision required from the owner through the parent

Authorize an explicit, source-bound three-level structure recipe for the Kifisias/A6 interchange only, retaining the current exclusions elsewhere. This changes the existing rule in `docs/OWNER-DECISIONS.md:128` (layer-1 bridge over ground only). It does **not** authorize merely raising the ring, bypassing failed approaches, changing source layer tags, arbitrary piers or weakening any gate. Until approved and all profiles pass, the existing ring exclusions remain unchanged.

## Concrete source and emitted dependency

Ten roundabout bridge ways are excluded in both committed east/north structure plans: w5168796, w215668928, w215668930, w215668931, w215668934, w604643289, w604643299, w604643301, w604643302, w1042971402. All have literal `bridge=yes`, source `layer=1`. The exact exclusion is `deck group w215668928:0 cannot be lifted safely: approaches too short (-20 m)`. This is the current two-level depression solver's failed approach metric, not a measured negative road length.

The bounded current source records sum to 305.460 m of tagged bridge centreline (not the complete ring perimeter); their bounds are x6374.835–6529.687, z−6992.076–−6838.799, entirely cell12,−14. Connected approach chains can extend outside this cell: their full node graph must be assembled before final affected-cell enumeration. No radius-selected road activation is proposed.

Physical dependencies, preserving distinct sourceLayer and emitted physicalLayer:

```
OSM ring bridge ways (sourceLayer1; proposed physical2; y NOT solved)
    above existing Kifisias approaches w219039054/56/58/59 (physical1)
    above A6 w154259480/484 (physical0)
```

[Authenticated contacts](ring-emitted-contacts.json) establish four actual ring/approach overlaps: w215668928 over w219039054 at6486.288,−6984.230 (middle y195.908617), over w219039058 at6495.842,−6978.703 (195.567025); w215668930 over w219039056 at6406.337,−6852.563 (194.655745), over w219039059 at6414.300,−6847.237 (194.581098). A ring at the same physical layer cannot model these crossings. With the existing half-metre slab and minimum4.5m clearance, ring road height must be at least middle road height+5m at each overlap. These are constraints, **not a selected absolute elevation**. Existing Kifisias-over-A6 contacts remain in the required audit.

The designer's [Greek project page](https://www.kalliergos.com/t-el/roadbridges-1/kifisias-circular-interchange-bridges) and [one-page PDF](https://static.s123-cdn-static-d.com/uploads/7980641/normal_6548a51735017.pdf), read2026-10-23, independently describe lowest motorway/rail, middle Kifisias53m×42m, upper circular bridge158m **outside diameter**,14m deck width. English lower-level order and radius wording conflict; neither is silently substituted. The sheet is a project description, not a surveyed pier-coordinate/elevation drawing. No actual pier coordinates can be extracted from it. All three requested Google pano URLs returned “No Street View imagery available here”; no pano date/profile is certified.

## Mapped context beyond guard posts

[Reduced source geometry](mapped-context-source.json) retains exact API snapshots/hashes, versions, tags and horizontal coordinates under OpenStreetMap contributors/ODbL1.0. Actual footprint polygons: w686877510v5 (candidate Kifisias footprint3130.66m²; exact source-family association still required), w1271896720v2 (circular bridge footprint8492.77m², bounds164.75m×165.06m), w247293987v5 (204.02m²; separate narrow footprint, do not misclassify as Kifisias), w440928885v5 (Rizariou735.87m²). Footprint extents are source measurements; they are not deck clearances or pier layouts. The circular footprint is a meaningful horizontal cross-check against the designer's diameter, not proof of identical measurement conventions.

Mapped retaining-wall lines: w475170425v5 length352.61m; w475170431v4 length1095.46m; w440936123v1 length139.17m. None has height/min_height/ele. No mapped bridge_pier features occur in these two snapshots. The existing importer discards this non-road context. The next supported context change should preserve these source features and construct wall faces only where a source-bound, certified ground/deck profile provides both top and bottom. A fixed6m extrusion or a nearest-road height is explicitly excluded.

Proposed additive source contract: `features(kind='retaining_wall'|'bridge_footprint', id, tags, geometry, refs)` with the existing source manifest hash/version provenance. Wall recipe adds `sourceId`, exact source geometry SHA, explicit retainedSide, profile sample stations with top/bottom y and exact supporting surface owners, source/profile hashes and no interpolation across missing samples. Reject ambiguous/missing support, inverted spans or intrusion into road/rail clearance. Bridge footprints can constrain fascia termination and approach transitions after matching their exact bridge source family; they cannot create contacts. No guessed pier mesh is proposed until a licensed drawing supplies positions/sections.

## Implementation and acceptance plan

- New `tools/world-gen/structure-recipes.py` and `areas/kifisias-interchange.structure.json`: explicit source-way/version/hash and dependency graph, owner-approved recipe kind; reject cycles/unknown sources/incomplete profiles. No broad policy switch.
- `ingest.py` additive context extraction (coordinate with source owner), `coastal.py`/`tiles.py` profile and contact-layer assembly (terrain owner), `plan-structures.py` one whole-area decision. Preserve sourceLayer1 independently of physical2; original source IDs/node connectivity remain authoritative.
- `tile_detail.py` uses matched bridge footprint and certified wall profiles for fascia/retaining faces; supports only from supplied surveyed coordinates. No runtime repair.
- `bridge_policy.py` exact approved recipe classification, preserving all current default exclusions. Tests in `bridge_policy_test.py`, new `structure_recipe_test.py`, `bridge_context_test.py`; packer/bridge audit and contact tests must cover physical0/1/2, no cross-layer turns, no false at-grade junction, full approach joins, exact seams, tow/AI placement and150km/h rail collisions.
- Every slab underside retains≥4.5m clearance above every lower driveable surface, not just its centreline. Keep asphalt≤30°, six-metre ground shoulder15cm step/30° sweep, guarded-deck0.25m shoulder and0.65m solid collision rail. Keep existing profile continuity constraints. If no faithful profile satisfies them, fail and report the exact residual rather than adjust thresholds.

## Finite resource envelope to test, not measured performance

The three wall lines require819 segments at maximum2m spacing at original source vertices (184+565+70), or1638 face triangles before cell clipping/certified gap omission. Double-sided rendering can use the existing material side mode; do not duplicate geometry. Exact segment/cell intersections reach five cells:11,−12;12,−14;13,−14;14,−14;14,−13. The source-vertex-only set misses14,−14 and is not sufficient. At four Float32 vertices plus six Uint16 indices per segment, the unshared wall geometry ceiling is49,140bytes before per-cell seam splits and metadata. Use one merged material batch/cell, no textures/lights/shadows. Final clipped counts, reservations, compressed bytes and Low/High draw/frame measurements must be reported.

For the ring, source/attachment profile completion precedes an honest triangle/byte estimate; it is not valid to budget only the305m bridge-tagged subset while omitting approaches. Proposed admission ceiling: existing per-cell/stream limits and owner detail≤+25% triangles/≤+10% draw calls, with at most one new structure-material batch per affected cell, no texture increase. These ceilings are rejection criteria, not permission to simplify topology. Run exact-candidate clean npm/physics/import/syntax and exhaustive generation gates, then matched actual-game drive/proof before publishing through the parent.
