# Athens world: infill and courtyard paving (2026-10-20)

World `athens-east-development`, dev flag only (`?map=athens`), computer only. **1,369 cells** baked again with the infill, the courtyard paving and the gardens. Manifest `manifests/fc9995d6150f1b98ec4732353ef2a0b4b11d864677c73130d27407aad3dab46b.json`, now the staging pointer in `wrangler.jsonc`.

## Gates (all 1,369 cells, unchanged limits)

| Gate | Result | Limit |
|---|---|---|
| Compressed world | 379,263,403 B = **361.3 MiB** (mean cell 0.28 MB, largest 0.76 MB, 7.3 MB resident) | 2 GiB |
| Worst 2×2 safety set | **26.8 MiB** | 64 MiB |
| Asphalt | 6,212,204 triangles, 0 above 30°, max 27.02° | ≤ 30° |
| Shoulders | 341,202,901 samples, max step 14.37 cm, max 29.89°, 0 missing contacts | ≤ 15 cm, ≤ 30° |
| Street grade | max 42.4% | 45% |
| Bridges | 44,378 edge samples, 0 unguarded; 16,525 clearance samples, 0 blocked (min 4.68 m) | |
| Junctions / sidewalks | 73,705 junctions, 0 holes; 3,456,808 sidewalk samples, 0 missing | |
| Failures | 0 (no `failures.json`) | |
| R2 staging total | 1.936 GB of 5 GB (6,504 objects, all sizes and the manifest hash checked) | 5 GB |

Roads are unchanged from the east bake, so the road gates are identical to it.

## Infill (`tools/world-gen/infill.py`, `infill.sqlite` beside `clean.sqlite`)

Every residential landuse polygon is cut by what OSM maps: buildings (1 m clearance), roads and footways with their width and a 2 m sidewalk, other landuse and landcover, water and coast, and the plazas and lawns of `assets/athens/`. What is left is the free interior. An interior is filled when it is at least 150 m², at most 3 ha (open land is left), and has at least 15% built ground in the 60 m ring around it. Lots are 8 to 13 m wide, 11 to 17 m deep, 4 to 7 storeys, and never smaller than 150 m². Up to 60% of an interior may be built. Lots go edge first, so they hug the block edge and the backs of existing buildings.

**Result:** 43,012 lots, 7.32 km² of footprint. Of 38,408 interiors, 78 were open land (over 3 ha) and 11,017 had too little built ring; both stay empty. A sample of 5,000 lots checked against every OSM exclusion gave 0 touching an OSM feature and 0 overlapping an OSM building.

**Per district** (lots nearest a picker district centre within 2 km, `infill-stats.json` and the README of the bake): Kifisia 4,748, Chalandri 3,013, Agia Paraskevi 2,184, Marousi 2,185, Voula 2,038, Glyfada 2,528, Patisia 1,623, Argyroupoli 1,533, Kallithea 1,031, Palaio Faliro 1,213, Peristeri 1,368, Nea Smyrni 807, Piraeus 896, Zografou 947, Ilioupoli 700, Vyronas 447, Exarcheia 385, Kypseli 389, Plaka 410, Kolonaki 320, Aigaleo 568, Syntagma 79. **Kaisariani: 3.** Its block interiors are mostly open land or sparse by the rules above; that is a finding, not a bug.

Generated records carry `generated: true` in `infill.sqlite`, so the audit can count them; the bake itself doesn't tag them per cell.

## Courtyard paving (`tools/world-gen/appearance.py`)

Residential landuse is the `urban` class (light grey paving, the same runtime texture as the centre's urban ground), where it used to be `earth`. Within it, a deterministic 10% of the 24 m cells of the world grid are `grass` (the small green yards). Gardens, parks and lawns inside a residential block still win as grass, and open land with no landuse stays `earth`. Tests: `tools/world-gen/dressing_test.py` (updated: residential is urban; yards are about 10% grass; open land is earth).

## Gardens and lawns (`tools/world-gen/gardens.py`, beauty handover step 5b)

`gardens.py` reads the Attica extract for closed ways tagged `leisure=garden|park`, `landscape=lawn` or `landuse=flowerbed`, and writes them as `landcover` into `infill.sqlite` (3,977 polygons). `ingest.py` had dropped those tags, so they were drawn as earth. Multipolygon relations are not read here.

## Ten-minute desktop drive (`measure-desktop-10min.json`)

Start at the default spawn, goals in Glyfada inland and Peristeri. **6,670 m, 0 holds, 0 missing contacts, 0 failures, 0 errors.** `carHits` 2,215, all in one window at about 180 to 210 s near (1886, 9970), inland Glyfada: a sustained contact with one AI traffic car while the pilot was on route. It is the same pattern as the 98 earlier (traffic and pilot, not generated lots and not parked cars). Frame median 500 ms, p95 817 ms on a loaded box (load about 9).

## Shots (1280×800, current prod client)

`shots/`: Glyfada inland street and above; Peristeri street (asphalt, parked cars, kerb, paved forecourt) and above; Kypseli street and above. `peristeri-above-before.webp` is the same view before the infill.

## Open

Kaisariani has 3 generated lots; its block rules need a look. The Peristeri street shot first tried a road edge that opened onto a courtyard, so the street frame uses a closer camera. Pilot contact with traffic (the 2,215 above) is unchanged.
