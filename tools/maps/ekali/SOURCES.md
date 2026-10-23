# Ekali source audit — not a released route

Codex gpt-6.1-sol, 2026-10-23. This record proposes a bounded real street
network for the next area. No route catalogue entry, generated height,
world publication, start grid or physical acceptance is implied.

## Sources and licence

Two bounded read-only official OpenStreetMap API requests returned HTTP 200:

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
and follows OSM one-way direction. Unspecified surface is still provisional.
No service road, footway or cycle track is used to manufacture connectivity.

## Candidate to inspect

One 2,085.944707 m connected source-polyline cycle near the
[GeoNames Ekali reference](https://www.geonames.org/262833/ekali.html)
(38.11035, 23.83505) follows these way transitions. The starting point is an audit point,
not a chosen timing line or safe grid. It uses no repeated node except closure.

| Way | Street | Node entering this source section |
|---|---|---|
| 44154570 | Fasideri | 6017564672 |
| 44130953 | Dekeleias, forward one-way | 560945008 |
| 44130952 | Pefkon | 560728637 |
| 44130959 | Unnamed mapped tertiary segment | 560728633 |
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

The four returned turn-restriction relations (6844186, 12668968, 13626465,
17571102) do not reference these candidate ways. This observation does not
replace a final restriction/conditional-access audit or an emitted graph check.
Street View character, exact directions, start/runouts, full-garage clearance,
road contact and grade still need acceptance before route authoring.

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
Existing basin metadata identifies Copernicus DEM, EGM2008, verticalOffset=0;
no available local authenticated DEM cache for Ekali has been established.
Terrain owns DEM acquisition, area configuration and world assembly. Route
work will consume its authenticated emitted output and leave the old seven
Kifissia proof cells protected unless coordinated reproof is required.
