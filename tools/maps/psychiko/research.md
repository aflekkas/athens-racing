# Psychiko drawn-loop revision

Revision date: 2026-10-15. The user's red loop in `.scratch/psychiko-v2/user-route.jpg` is now the primary race. The drawing extends into Filothei north of the Palaio Psychiko municipal boundary; it is not truncated at that boundary.

`raw/drawn-course.json` freezes 172 unique junction/shape nodes plus the repeated finish node, with one exact OSM way per edge. `route.mjs` verifies adjacency and public access, then periodically smooths/resamples at approximately 2 m. Raw polyline length is about 5,992.671 m; the playable lap is **5,960.933287659299 m**. Start/finish is on Diamantidou at OSM node **272560900** (38.0162798, 23.7709014). `psychiko-race` is two laps, **11,921.866575318598 m**, against three rivals. `psychiko-tt` retains one lap in the bundle and stays disabled by the existing menu/launch policy and its explicit disabled flag. `free:psychiko` uses the shared untimed free-roam event, with civilian traffic and street life.

## Drawing review and interpretation

The prior skeleton/map match was reviewed both on labelled OSM and as a cyan overlay on the user's original drawing (`.scratch/psychiko-v2/route-overlay.png`). The exact OSM chain follows Diamantidou, 25is Martiou, Marathonodromou, Elikonos, Kamara, Agiou Dimitriou, Sismanoglou, Malakasi, Areaki, Benaki, Korytsas, Bizaniou and the northern 25is Martiou / Nirvana / Davaki / Pavlou Mela / Dryadon / Achillea Paraschou / Nikiforou Lytra return. Short connecting OSM ways and roundabout arcs retain their source identity. There are no invented diagonal connectors or repeated route nodes. The timing line was moved to the long Diamantidou avenue to keep the grid away from the northern corner.

The supplied image is a photographed satellite map with a thick freehand line. Georeferencing is approximate; nearby bends, roundabouts and parallel street choices cannot be treated as a survey. The chosen match retains the drawing's full shape and uses connected public motor roads. Three short northern ways have no OSM surface tag (545646473, 545649904, 545649903); these are inferred paved residential connections, not independently surveyed asphalt. Unlike the original race, the closed course intentionally uses some OSM one-way streets in reverse. Free-roam network metadata keeps the source one-way flags.

## Whole neighbourhood and original work

`raw/boundaries.json` freezes OSM municipal relation **1403235**, Palaio Psychiko, and the adjacent Filothei/Neo Psychiko relations for context. Every public motor-road way with a node in the Palaio Psychiko boundary is selected, plus the entire drawing interior, ways within 280 m of the drawn race and every original garden-course way. Private/no-access roads, private driveways, parking aisles and non-motor paths are excluded from the public-neighbourhood selection. The shared at-grade extractor omits Kifisias tunnel ways 25117418, 113339568 and 113339581; these underpasses need a separate grade-separated reconstruction. All other selected source ways have rendered road parts or belong to the primary course. The shared road-network extraction and road/terrain contact systems produce **564 road parts / 82.281 km** of surrounding drivable streets. **3,507 mapped building footprints** supply neighbourhood context. Street widths, garden boundaries, facade appearance and vegetation remain estimates.

The original **4,285.748891 m** loop is preserved in `raw/garden-route.json` and `raw/garden-route-dem.json`; all of its centreline samples are verified as drivable on either the primary route or the surrounding asphalt network. It is not registered as a second race, because the runtime has one active route geometry per map.

## Closures and elevation

All outgoing public OSM half-edges at race-route nodes, excluding the two raced edges, produce one closure each: **92 exits / 92 solid closures**. Source node/way provenance is stored in the bundle. Most cross the outgoing carriageway beyond the raced asphalt; three short slip/roundabout arms use a barrier along the outside race edge. Water-filled barriers, striped rails, cones and `ΕΡΓΑ · ΚΛΕΙΣΤΟ` signs share the same positions as the production collision boxes. Switching to free roam hides the visuals, removes the colliders and clears the collision hash.

The existing EU-DEM terrain grid is retained. **250 direct road stations** were refreshed for the drawn loop via OpenTopoData eudem25m. Periodic sigma-60 m filtering gives **180.76–228.33 m approximate road elevation**, **81.73 m ascent/descent**, **10.0% maximum grade**, and **2.07 m maximum error from direct DEM stations**. The local terrain carving grid remains 10 m interpolation of coarser source data, not a 10 m survey.

The earlier source research follows for historical context; its route lengths, event geometry and measured elevation statistics refer only to the preserved first version.

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
