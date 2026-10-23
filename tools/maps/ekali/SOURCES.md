# Ekali source audit — not a released route

Codex gpt-6.1-sol, 2026-10-23. This record proposes a bounded real street
network for the next area. No route catalogue entry, generated height,
world publication, start grid or physical acceptance is implied.

## Sources and licence

The two initial exploration extracts below were superseded by the expanded
canonical source. They are insufficient for generation of the physical halo.
Both bounded read-only official OpenStreetMap API requests returned HTTP 200:

| Purpose | Request bbox (west,south,east,north) | Bytes | Response SHA-256 |
|---|---|---:|---|
| Local road patch | `23.826,38.103,23.840,38.115` | 2,049,481 | f60813997fdea86ce0b997b4f5725b11fa2cb6727860e1eb700672da5a30c9c8 |
| Boundary connection strip | `23.826,38.096,23.840,38.104` | 1,694,515 | 86799acfd5925c3fcee86335bed8fc27b57ab0767a061b3eaf259bb66fffe118 |

Source URLs are `https://api.openstreetmap.org/api/0.6/map?bbox=BBOX`.
Requests were each capped at 2 MiB. The first rectangle is approximately
1.228 km by 1.336 km (1.64 square kilometres). Map responses include whole
ways crossing the rectangle, so some returned nodes lie outside it. Responses
carry OSM contributor attribution and [ODbL 1.0](https://www.openstreetmap.org/copyright).
Raw XML stays task-local; no third-party imagery is committed.

The first response has 4,791 nodes and 95 **initial** road ways after selecting
residential/primary/secondary/tertiary/unclassified/living_street and rejecting
`access=no/private`. That is not a legal or physically safe route count.
Subsequent source-only cycle exploration merges both responses, omits primary
roads, rejects no/private/agricultural/forestry/destination access for access,
vehicle, motor_vehicle and motorcar, excludes explicitly non-paved surfaces,
and initially follows only explicit OSM one-way tags. The canonical audit below
rejects an implicit-roundabout direction error from that preliminary search.
Unspecified surface is still provisional.
No service road, footway or cycle track is used to manufacture connectivity.

## Canonical source, 2026-10-23

Terrain assembled one read-only canonical XML from the official API; this
agent read the same file without duplicating the download. It contains
62,589 nodes, 7,171 ways and 143 relations, including 52 restrictions.
The 15,643,924-byte canonical response has SHA-256
`6b3a65219bc0f2d94603b867c5da7e94db16e9160d6112f39ea9c9677dfdca33`.

The original combined bbox `23.8117,38.0904,23.8526,38.1272` returned HTTP 400
at 06:51:33 UTC because the map endpoint limits requests to 50,000 nodes.
The recorded subdivision/closure requests were:

| Request | Read time UTC | Bytes | Response SHA-256 |
|---|---|---:|---|
| `/api/0.6/map?bbox=23.8117000,38.0904000,23.8526000,38.1088000` | 06:51:35.112662 | 12,344,748 | e3c0a32bb9b079ab558091c594f3c9ffe79095758610ab92f7b892fd183cfaff |
| `/api/0.6/map?bbox=23.8117000,38.1088000,23.8526000,38.1272000` | 06:51:39.275247 | 4,548,546 | 8bc82a89fcb1e1a0f283198b087abfb5ef839490489bc43b802076f565a53a5b |
| `/api/0.6/way/556144178/full` | 06:51:42.212777 | 1,129 | 5c3e6e1d2e09bbf2d904e8c35bf01aa4f5877e81af4c4b4f880c11dde96c1dea |

All URLs are on `https://api.openstreetmap.org`. The canonical sidecar records
zero missing way nodes and complete restriction member closure, with whole-way
node order retained. It explicitly enumerates **22,418 unresolved nonrestriction
relation members**, including broad boundaries and transit routes. This is not
complete membership for every relation, and incomplete area relations must not
be turned into invented polygons. Terrain owns source assembly and its tests.

## Candidate to inspect

The corrected 2,116.978544 m connected source-polyline cycle near the
[GeoNames Ekali reference](https://www.geonames.org/262833/ekali.html)
(38.11035, 23.83505) follows these way transitions. The starting point is an audit point,
not a chosen timing line or safe grid. It uses no repeated node except closure.

| Way | Street | Node entering this source section |
|---|---|---|
| 44154570 | Fasideri | 6017564672 |
| 44130953 | Dekeleias, forward one-way | 560945008 |
| 44130952 | Pefkon | 560728637 |
| 44130959 | Roundabout, legal forward traversal | 560728633 |
| 44130950 | Parnithos | 560728629 |
| 44130941 | Unnamed mapped residential segment | 560728572 |
| 44130958 | Platanon, forward one-way | 560728574 |
| 44130942 | Aspasias | 560728580 |
| 44130950 | Parnithos, separate section | 560728578 |
| 44130954 | Petaloudas | 560728630 |
| 44154570 | Fasideri, separate section | 560728645 |
| 888683829 | Fasideri | 8262180142 |
| 44154571 | G. Vlachou | 560945079 |
| 888683915 | Kedron | 8262149927 |
| 44154572 | Kedron | 8262154221 |
| 638497823 | Efterpis | 6017564673 |

The original 2,085.944707 m proposal was rejected: it traversed four edges
of way 44130959 backward. `junction=roundabout` implies forward one-way in
the repository normalizer even without an explicit `oneway` tag. The corrected
proposal follows its twelve forward edges from node 560728633 through
560728669/668/667/649/666/665/664/631/663/662/661 to 560728629. No reverse
connector or relaxed direction rule is used.

The canonical audit executes the repository `clean.py` road_parts and
public_direction functions with `model.py` road_tags, complete source node
order, node-use counts and node-rule context. All 56 source-adjacent traversals
are public in their proposed direction. None of the canonical source's 52
restriction relations references a candidate way. Reviewed node coordinates,
traversals, way versions/tags, normalizer hash and boundary parts are recorded
in `source-review.json`; this is source planning data, never a playable route
definition or physical validation. Street View character, start/runouts,
full-garage clearance, emitted road contact and grade still need acceptance.

Candidate geometry bounds are 38.1101318–38.1151526 north and
23.8324245–23.8397762 east. Exact segment/grid intersection in `athens-v1`
uses three core cells: `17,-29`, `18,-30`, `18,-29`. A one-cell halo contains
15 cells: x16/z-30..-28, x17..19/z-31..-28. This is a source planning footprint,
not the final emitted contact proof or an instruction to rebake old cells.

## Genuine connection to the existing world

The authenticated world revision is
`80055f9208753e2d6fa8658b31c90216d22c650f7f33588ebd5178d1a6b804a1`,
from the Kifissia source record. It has no Ekali core cells. The existing north
boundary in this corridor is z=-13312, latitude 38.0995831836. Bounded decoding
verified these existing immutable source cells:

| Cell | Bytes | Compressed SHA-256 |
|---|---:|---|
| 16,-26 | 323,724 | e7417a9f08a4d9b0286c6b8b16d01a7361fdb0aaa1a9e5ba3cdd50d0e58be478 |
| 17,-26 | 161,015 | f857b1a6d32f630988337112f9f1ce7f0a3de83f70cf9e81f69dbea1135bf293 |

Real boundary portals include:

- Northbound Rodon: `osm:way:81720483:0-1:f:17:-26` ends at
  `portal:w81720483:0:270.506540`, world `[8801.761,342.034943,-13312]`.
  Current OSM way 81720483 v9 crosses the line between nodes 952161543 and
  952161298, in its legal forward direction.
- Southbound Rodon: `osm:way:81720521:41-1:f:17:-26` starts at
  `portal:w81720521:41:25.196428` and ends at node 952160960. Current OSM way
  81720521 v12 crosses the line between nodes 7839198255 and 952160960.
- Thiseos: `osm:way:216905290:21-1:b:16:-26` and its `f` counterpart use
  `portal:w216905290:21:15.134034`, world `[8370.955,304.318726,-13312]`.
  Current OSM way 216905290 v12 crosses between nodes 8026835328 and 8555209888.

These are real source/emitted identities, not a new connector. A new z-27/-28
corridor and matching portal heights must be generated and proved. Existing
source endpoint elevations are not substitute DEM samples for the new area.
Terrain subsequently authenticated Copernicus GLO-30 DSM N38/E023, EGM2008,
from the repository fetch pipeline: 32,409,679 bytes, SHA-256
`c289c4a9b2c5c8b5b07e475129134bbb6b64b3ccb86d23eca3428b8e7f5bce28`.
The source URL is
`https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N38_00_E023_00_DEM/Copernicus_DSM_COG_10_N38_00_E023_00_DEM.tif`.
Its reduced pixel-window-halo1-v1 crop covers 23.8,38.08,23.87,38.14,
142,528 bytes, SHA-256
`59d984ef5a145f90bb614c7aef31677877c6d32cb9d1da37363eefb0d7fc87b7`;
this agent independently verified the crop hash. Different existing emitted
endpoint heights and new DEM samples require common-field boundary gates;
no arbitrary height offset is assumed. Terrain owns DEM acquisition, area
configuration and world assembly. Route
work will consume its authenticated emitted output and leave the old seven
Kifissia proof cells protected unless coordinated reproof is required.
