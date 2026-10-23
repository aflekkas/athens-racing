# Kifissia / Kefalari circuit sources

Author: Codex gpt-6.1-sol, 2026-10-23. No photographs, Google imagery, map
service tiles or downloaded render cells are committed. The route and proof
contain OpenStreetMap-derived directed geometry, names and bounded physical
queries, under [ODbL 1.0](https://www.openstreetmap.org/copyright), using the
existing generator and terrain source provenance in authenticated AWT metadata.

## Immutable physical source

Public staging manifest:
`https://staging.athensracing.com/world/manifests/55d13b9a8643363d7cf1a9390fd1994869ff8326c16e61d42bb7c278f2cfb74b.json`

Composed world revision:
`80055f9208753e2d6fa8658b31c90216d22c650f7f33588ebd5178d1a6b804a1`.
The existing loader authenticates the world descriptor and each region manifest.
The offline reader verifies compressed SHA-256, byte size, AWT identity and
contact tables for every downloaded cell. Initial inspection used 36 cells;
only seven contribute route contact proofs (2,031,067 compressed bytes):

| Cell | Compressed SHA-256 |
|---|---|
| 13,-20 | 4cda8192c4cbaf52c95fe4b22d4d1206118e044cb2488e2eca97e02422912e75 |
| 14,-20 | 975eebbaab9e8ac1d39a5e6a1561f630ab482e593fbff58a77eb90193f8c3538 |
| 14,-21 | 17ec3afbf07589a06a2217c3188a1c02bcaad35ef518b6279f174aed06c727c4 |
| 14,-22 | 962ab0bee7ede7ef4d1ce4d1048212f297c607290e65fb518ab50543be7d942f |
| 15,-20 | 85957e3949007e1a7a79f46353f4b860631276da5990a304d244dd9f44170ac2 |
| 15,-21 | d3fc0efacc9ddeaba0fd3565ffa1127d0306e4d3081c7cca2876b35ca00d9b8d |
| 15,-22 | 5db2f4552ab2936d3398feca483249cb825857f9028f360a581df294210f5fc8 |

The source identity in those entries is `athens-east-development` revision
`2881ca7fd0b8aeea46ac66a296e14cd6033d78936fb113ffc0cb8d5015b1da39`.
`data/routes/validation/kifissia.inputs.json` records the physical query proof,
complete cell metadata and exact compressed hashes. Its SHA-256 is
`182e41f0a3809042ee87a9367e6058c3215d112c754b7ecc1732fd0220f6fef2`.
No cell bodies, triangle arrays or generator caches enter Git.

## Street sequence and direction

The 2,926.566598 m circuit follows Kokkinara east from Levidou, Charilaou
Trikoupi south beside Kefalari park, Pentelis west, Kapodistriou south,
Alonion west, Agion Theodoron, Kyriakou, Georgiou Drosini, Kassaveti east and
Levidou north. The authored JSON contains 52 directed edge entries (51 distinct
edges, with the timing edge split between the lap's beginning/end); contact
surface changes split these into 108 runtime occurrences. No reverse race is
offered, because it would violate one-way streets. Two laps in both race and TT.

The route uses existing graph nodes and legal directed successors at every
turn, including physical tile portals. No straight-line link joins streets
across a block. A candidate returning west along Kassaveti was rejected at the
source-selection stage: the emitted road is eastbound. The legal southern
return via Kapodistriou and Alonion preserves that direction.

An initial Levidou timing pose failed the unchanged 151 m runout footprint
check on `osm:way:388932358:9-0:f:14:-21`; moving farther north still failed
near the Levidou/Kokkinara turn. Those candidates were discarded. The chosen
line is 8 m into `osm:way:260244314:0-0:f:15:-22` (Kokkinara). The compiler
proves the complete 80 m run-in, all three single-file grid poses and the
151 m runout with the existing 1.1 x 2.8 m half-footprint. No width, obstacle,
layer, contact, access or continuity guard was relaxed.

## Inspected Street View references

Inspected in the Cogenly collaborative preview on 2026-10-23. Image dates below
are the dates shown by Google, not a claim about today's construction state.
The observations justify only street character at these locations. They do
not establish photographic fidelity everywhere on the course.

| Location / requested viewpoint | Image date | Observed |
|---|---|---|
| [44 Deligianni, 38.075563, 23.816462](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=38.0756,23.8165) | Oct 2024 | Raised sidewalks, mature roadside trees, parked cars, hedges and property fences. |
| [8 Kokkinara, 38.077762, 23.819041](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=38.0778,23.8190&heading=90&pitch=0) | May 2024 | Narrow residential asphalt, low boundary walls, mature pines, sidewalks and parked cars. |
| [4 Philadelpheos beside Kefalari park, approximately 38.0745, 23.8203](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=38.0745,23.8203&heading=0&pitch=0) | Sep 2024 | Planted park with mature trees and paths, pavement and low roadside posts. This street is adjacent reference context, not part of the lap. |
| [65 Charilaou Trikoupi, approximately 38.0748, 23.8211](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=38.0748,23.8211&heading=180&pitch=0) | Sep 2025 | Separate one-way carriageways divided by a planted median; Kefalari park and railing to the west. |
| [7 Evryalis, approximately 38.0790, 23.8240](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=38.0790,23.8240&heading=270&pitch=0) | May 2024 | Residential boundary walls, trees, sidewalks, parked cars. Off-course reference; no route decision relies on it. |

Google Street View is visual reference only. OSM supplies reproducible road
geometry/direction; the game's existing procedural OSM scenery supplies the
world. This change does not hand-place photo textures, widen streets, replace
building footprints or invent a park/median just for the race.

## Reproduce

Obtain only the route's hash-verified emitted source cells plus the one-cell
halo from the manifest, in a task-local temporary directory. Supply the flat
composed manifest to:

```sh
node tools/author-kifissia-route.mjs WORLD_JSON CELL_DIRECTORY EMPTY_OUTPUT_DIRECTORY
```

For an offline hash-named cache, give manifest entries relative URLs of
`SHA256.bin.gz`; keep all identity, source, size and budget metadata unchanged.
Those local transport URLs are omitted from the proof. The tool uses the
reviewed exact edge sequence; it never falls back to snapping, rebaking,
uploading, changing the world or inventing a connector.

## Kifisias crossing source audit, 2026-10-23

A later bounded read of the official OSM API succeeded (HTTP 200). These are
current way metadata, separately dated from the immutable emitted cells above;
no claim is made that their current versions were used in those cells. Source
URLs use `https://api.openstreetmap.org/api/0.6/way/ID`. Full response SHA-256s:

| Way | Version / source timestamp | Observed tags | Response SHA-256 |
|---|---|---|---|
| 26984266 | 31 / 2026-08-26T13:53:54Z | Kifisias, primary, bridge=yes, layer=1, oneway=yes, lanes=2 | 013cebbea55ba2852e7f3c71426a920e9d9a436ce81d59a31d7292b32831f5b2 |
| 154259484 | 46 / 2026-09-06T21:37:57Z | Attiki Odos, motorway, oneway=yes, lanes=3 | 0afc6ba03a51ee76f0f2de4d3a3c46f7c73cb6c7c5e5f16932413ff293c40d38 |
| 154259480 | 43 / 2026-09-06T21:37:57Z | Attiki Odos, motorway, oneway=yes, lanes=3 | d0068768510d3497c746d2f0e4e81bb79d91c7bda526ac8edf4cbb4e631a7f0d |
| 23200519 | 13 / 2024-06-06T08:14:47Z | Dionysou, residential, bridge=yes, layer=1, lanes=2 | 85196c86d729b3af863bf6d8d476f653e67f65fb47200bb5de0fb9934a7ec59f |
| 32067820 | 24 / 2026-08-26T13:53:54Z | Kifisias, primary, bridge=yes, layer=1, oneway=yes, lanes=3 | e7aad81a559e9d7f47c70ce39bf94329891b71453404d796a59f33ded70d5e1d |
| 87150957 | 26 / 2026-08-26T13:53:54Z | Kifisias, primary, bridge=yes, layer=1, oneway=yes, lanes=5 | 59a26687e20e27170c06fc66b93e2760d1ed5dc68204a11b18bf2d62bcc736ee |
| 98895975 | 18 / 2024-08-05T18:43:36Z | Olympioniki Spyrou Loui, secondary, oneway=yes, lanes=2 | ac894d2ff8a5b1c12ac8f183ca42ea0596fda7f6601791141e25bd305d11e2a0 |

The two Attiki Odos ways and lower Spyrou Loui way have no explicit `layer`,
`bridge`, `tunnel`, `cutting` or `embankment` tags in these responses. Absence of
a tag does not establish a flat or non-depressed approach. The source supports
upper bridge ordering, but does not justify a uniform six-metre lower-road
depression. The nearby `w23200519` crossing is **Dionysou residential bridge**,
not a motorway ramp. Exact terrain audit intersections are world
`[6451.72,-6926.43]`, `[6224.83,-6984.31]`, `[5636.42,-5822.65]` respectively.
Street View inspection of the actual approach profiles remains outstanding.
Terrain/infrastructure owners received these facts; no geometry was changed.
