# Psychiko Garden Circuit v2 (2026-10-18)

Owner feedback after the drawn-loop revision: "also psychiko map is bad", "i want [the minimap route] to start from the blue dot and go around or whatever", "this part is not done properly", "also what the fuk are these white dots". The loop is redesigned from the street graph rather than from a drawing.

## Findings

- The blue dot on the minimap was the off-map pointer for the first rival (cyan, drawn at the rim in the direction of the other car), not a start marker; it pointed back down the Diamantidou radial, which is where the owner wants the lap to begin. The old timing line sat north of the roundabout, on the same radial.
- The old route's northern stretch (Nikiforou Lytra, Achillea Paraschou, Dryadon, Pavlou Mela, 25is Martiou) was a freehand drawing matched to ways, joined by three short unnamed connectors without a surface tag, with knife-edge corners at junctions. The new lap uses none of those connectors and fillets every junction corner.
- The white squares along the route are the minimap's traffic dots (`rgba(255,255,255,.75)` squares drawn for every active civilian car); see the 2026-10-18 report for what produced them in a race.

## Selection

All public, paved, non-private OSM motor ways around the fan of Palaio Psychiko were searched for closed loops through the Diamantidou radial that obey `oneway` tags and roundabout direction. The chosen loop (3,753.4 m) runs: Diamantidou (start/finish, heading south) -> Agiou Dimitriou -> Kamara roundabout -> Kitheronos / Prigkipisas Elenis -> Areaki star roundabout -> Kokkoni -> Benaki diagonal -> Diadochou Pavlou -> Dryadon -> Karkavitsa -> Nikiforou Lytra -> Diamantidou back through the Venizelou roundabout to the line. It mixes the radial avenue, ring streets, two diagonals and three roundabouts, and has no turn tighter than a 6 m radius.

## Elevation

Road height follows direct EU-DEM v1.1 samples at ~24 m stations (`raw/route-dem.json`), smoothed over about 24 m; maximum grade about 10.5%.

---

# Original garden-loop research (retained historical reference)

Research date: 2026-10-14. Coordinates are WGS84 latitude, longitude. This is a fictional closed-road racing event on real public streets, not an existing sanctioned race.

## Selected loop

**Vasileos Pavlou → Dimokratias → Agiou Dimitriou → Diamantidou → Eleftheriou Venizelou roundabout → Malakasi → Stratigou Kallari → Taygetou → 25is Martiou → Marathonodromou → Kyprou → Yakinthon → Chlois → Vasileos Pavlou**.

Measured raw OSM polyline: 4,309.45 m. Periodically smoothed/resampled game lap: **4285.75 m**. Start/finish on Vasileos Pavlou at **38.0010950, 23.7693876**, beside source node [272499400](https://www.openstreetmap.org/node/272499400). One lap for `psychiko-tt`; two laps (8,571.50 m) for `psychiko-race`. All OSM road nodes are unique until the final return to the timing line. No out-and-back overlaps or artificial connectors.

The circuit deliberately stays inside Palaio Psychiko rather than crossing Kifisias into Neo Psychiko. Marathonodromou's parallel road is used briefly; Kifisias itself, Mesogeion and Katechaki are excluded. The first avenue sections offer passing room; the Venizelou roundabout, Malakasi bend, Kallari sweep and Kyprou return require braking. The named routes supplied in the brief were treated as leads, not assumed geography: OSM spells Diamantidou as both `Διαμαντίδη Δημητρίου` and `Λεωφόρος Δ. Διαμαντίδου`. No Dimokritou road was substituted by name.

## Exact via junctions

| OSM node | Latitude | Longitude | Game station m |
|---|---:|---:|---:|
| [272499400](https://www.openstreetmap.org/node/272499400) | 38.0010938 | 23.7693869 | 0.00 |
| [272560814](https://www.openstreetmap.org/node/272560814) | 38.0128973 | 23.7723973 | 1607.91 |
| [272554949](https://www.openstreetmap.org/node/272554949) | 38.0138147 | 23.7749400 | 1861.89 |
| [347783946](https://www.openstreetmap.org/node/347783946) | 38.0084547 | 23.7770447 | 2673.84 |
| [1285491847](https://www.openstreetmap.org/node/1285491847) | 38.0008078 | 23.7718242 | 3797.78 |

## Ordered OSM way segments

Every raced way is tagged `surface=asphalt` and `highway=tertiary` or `residential`. None has `access=no/private` or `motor_vehicle=no/private`. The directed graph respects every `oneway=yes`; a way listed in reverse is a two-way street. The route builder rejects missing edges and repeated nodes. Ways can be used only partially between junctions; these endpoint node IDs define those exact subsegments.

| Order | OSM way | Mapped name / international name | From node | To node |
|---|---|---|---|---|
| 1 | [377028378](https://www.openstreetmap.org/way/377028378) | Vasileos Pavlou | 272499400 | 272499401 |
| 2 | [25053074](https://www.openstreetmap.org/way/25053074) | Unnamed paved junction | 272499401 | 6713257816 |
| 3 | [545647401](https://www.openstreetmap.org/way/545647401) | Vasileos Pavlou | 6713257816 | 272499532 |
| 4 | [72034923](https://www.openstreetmap.org/way/72034923) | Stratigou Mazaraki | 272499532 | 272499435 |
| 5 | [1099465037](https://www.openstreetmap.org/way/1099465037) | Dimokratias | 272499435 | 272499017 |
| 6 | [25048557](https://www.openstreetmap.org/way/25048557) | Agiou Dimitriou | 272499017 | 272499018 |
| 7 | [25048553](https://www.openstreetmap.org/way/25048553) | Diamantidi Dimitriou | 272499018 | 6193531351 |
| 8 | [661583995](https://www.openstreetmap.org/way/661583995) | Λεωφόρος Δ. Διαμαντίδου | 6193531351 | 6193531348 |
| 9 | [978004329](https://www.openstreetmap.org/way/978004329) | Diamantidi Dimitriou | 6193531348 | 272560814 |
| 10 | [25053533](https://www.openstreetmap.org/way/25053533) | Odos Eleftheriou Venizelou | 272560814 | 6713021663 |
| 11 | [545646480](https://www.openstreetmap.org/way/545646480) | Μαλακάση | 6713021663 | 272499517 |
| 12 | [717372567](https://www.openstreetmap.org/way/717372567) | Μαλακάση | 272499517 | 272554949 |
| 13 | [545646479](https://www.openstreetmap.org/way/545646479) | Stratigou Kallari | 272554949 | 272554713 |
| 14 | [468238645](https://www.openstreetmap.org/way/468238645) | Stratigou Kallari | 272554713 | 272554946 |
| 15 | [25053123](https://www.openstreetmap.org/way/25053123) | Stratigou Kallari | 272554946 | 272554942 |
| 16 | [25053506](https://www.openstreetmap.org/way/25053506) | Stratigou Kallari | 272554942 | 272560606 |
| 17 | [468237309](https://www.openstreetmap.org/way/468237309) | Stratigou Kallari | 272560606 | 347783946 |
| 18 | [25053101](https://www.openstreetmap.org/way/25053101) | Taigetou | 347783946 | 2436338816 |
| 19 | [25053095](https://www.openstreetmap.org/way/25053095) | Unnamed paved junction | 2436338816 | 2436338815 |
| 20 | [62331516](https://www.openstreetmap.org/way/62331516) | 25is Martiou | 2436338815 | 272554420 |
| 21 | [661584002](https://www.openstreetmap.org/way/661584002) | 25is Martiou | 272554420 | 4602201104 |
| 22 | [465224134](https://www.openstreetmap.org/way/465224134) | 25is Martiou | 4602201104 | 1285491927 |
| 23 | [465224121](https://www.openstreetmap.org/way/465224121) | Paraplefri Odos | 1285491927 | 1285491862 |
| 24 | [465224115](https://www.openstreetmap.org/way/465224115) | Marathonodromou | 1285491862 | 1285491853 |
| 25 | [113339578](https://www.openstreetmap.org/way/113339578) | Marathonodromou | 1285491853 | 1285491847 |
| 26 | [1354467835](https://www.openstreetmap.org/way/1354467835) | Kyprou | 1285491847 | 272561716 |
| 27 | [31250515](https://www.openstreetmap.org/way/31250515) | Kyprou | 272561716 | 347435540 |
| 28 | [31250509](https://www.openstreetmap.org/way/31250509) | Hyacinthon | 347435540 | 272554492 |
| 29 | [662440745](https://www.openstreetmap.org/way/662440745) | Hyacinthon | 272554492 | 272554491 |
| 30 | [107941910](https://www.openstreetmap.org/way/107941910) | Chlois | 272554491 | 272499399 |
| 31 | [25048611](https://www.openstreetmap.org/way/25048611) | Vasileos Pavlou | 272499399 | 272499400 |

## Primary data and context

- Full primary OSM extract from [Overpass](https://overpass-api.de/api/interpreter), bbox south37.992 / west23.758 / north38.027 / east23.799. `raw/osm.json.gz` freezes all returned nodes and ways. Fetcher includes the same primary OSM XML API fallback as Penteli, but it was not needed. © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright .
- Terrain: [EU-DEM v1.1](https://www.opentopodata.org/datasets/eudem/) through `https://api.opentopodata.org/v1/eudem25m`, with 1,443 bilinear terrain samples at100 m and 180 direct road stations at approximately24 m. Raw arrays are frozen. The game interpolates them onto a10 m carving grid; this is not10 m source DEM accuracy. Periodic Gaussian road filtering has sigma60 m. The final road differs from direct DEM samples by at most2.12 m; elevation184.52–203.34 m, ascent/descent35.02 m per lap, maximum grade5.5%.
- [Czech Embassy's own directions](https://mzv.gov.cz/athens/en/kontakty.html) independently identify Diamantidou, the Eleftheriou Venizelou circus and Dimokratias in Palaio Psychiko, and distinguish the adjacent Neo Psychiko addresses.
- [BLP architects: Psychico House, Diamantidou Street](https://blp.gr/projects/psychico-house-diamantidou-street/) documents a real single-family residence with terraced, densely planted garden boundaries and a substantial difference in adjacent street levels. This informs the villa/garden character, not a literal reconstruction of that individual property.

## Street-level observations

Public Google Maps Street View was opened before modelling. Two panoramas were actually rendered and personally inspected, with attribution retained in ignored `.scratch/psychiko/` source PNGs:

1. Diamantidou42: requested38.0126,23.7723, bearing180°; snapped38.0126551,23.7723670; panorama `9Q4JR2V_ywleu6_RNyrl8Q`, capture September2024. Dense mature pines and broadleaf street trees, low stone/plaster villa walls with metal fencing/hedges, tiled pavements, parked cars and double white centre lines. File `street-diamantidou.png`.
2. Agiou Dimitriou50 / Kallari junction: requested38.01184,23.77869, bearing210°; snapped38.0118376,23.7787348; panorama `OM1Pkpuc2Z4EJ7VKZpgIow`, capture April2026. Broad paved junction, mature umbrella pines and garden hedges, narrow paved footways, street signs and double centre lines. File `street-kallari.png`.

Viewer URLs and reconstruction limits are recorded in SOURCES.md. The selected stage's low-rise villas use actual OSM footprints. Heights without mapped levels, facade styles, tree species/placements, wall/gate runs, nominal7 m carriageway and1.8 m pavements are representative modelling estimates. No embassy is claimed as an individually surveyed landmark. No source imagery is shipped as a texture. The game is a single dry-season reconstruction; the two source dates differ.
