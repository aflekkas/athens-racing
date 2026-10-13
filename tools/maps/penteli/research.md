# Dionysos / north Penteli route research

Research date: 2026-10-13. Coordinates below are WGS84 **latitude, longitude**. Route distances are measured on OSM node geometry, not straight lines. Heights are approximate SRTM90m ground elevations, not surveyed road elevations.

## Recommended geography

Use the paved **Dionysos → Agios Petros fork → Karakanta spring** route, approximately **9.91 km**. Start on Dionysou at its junction with Vomou Dionysou in the southern part of Dionysos, traverse the northern/back side of Penteli southeast, turn right at Agios Petros toward Penteli, and climb southwest toward Karakanta. This preserves the requested Dionysos start and real northern mountain road while providing a substantial final climb.

The first **5.46 km** to the fork is rolling: roughly 477 m at the start, a low around 436 m, then 499 m at the fork. It is not a continuous climb. The next **4.45 km** toward Karakanta gains approximately 215 m. Sampling the combined route at approximately 200 m intervals gives about **334 m ascent / 99 m descent**, with approximately **64% of sampled distance rising**. These totals include coarse DEM noise and should be labeled approximate.

If a continuously climbing stage matters more than starting inside Dionysos, start around the northern road low point at **38.0824570, 23.9120173**, about 2.55 km into the above route; the remaining route to Karakanta is approximately 7.36 km, still with short rolling sections.

## Exact points and road identity

| Point | Latitude | Longitude | Approximate elevation | OSM identity |
|---|---:|---:|---:|---|
| Dionysos start, Dionysou × Vomou Dionysou | 38.0944623 | 23.8940002 | 477 m | shared endpoint of ways 127528594, 507294913, 25513514 |
| Northern road bridge | 38.0829909 | 23.9072888 | 447 m | junction of ways 127528594 and 124519741 |
| Road low point | 38.0824570 | 23.9120173 | 436 m | node on way 124518687 |
| **Agios Petros road fork** | **38.0719843** | **23.9345426** | **499 m** | **node 278007766** |
| Agios Petros chapel | 38.0720891 | 23.9343704 | nearby 500 m | way 368804380 center from Nominatim |
| Penteli branch intermediate junction | 38.0696307 | 23.9280081 | 584 m | endpoint of ways 124517366 and 224029848 |
| Karakanta spring | 38.0670148 | 23.9008502 | 715 m | drinking-water node 1172662193 |
| Road finish nearest spring | 38.0669233 | 23.9010199 | 712 m | road node 3657221927, approximately 18 m from spring |

The OSM road name is **Διονύσου / Dionisou** on both branches. The town-to-fork road carries **ΕΠ29**, the Ekali–Nea Makri provincial road; the right turn toward Penteli carries **ΕΠ5**. Main ways are tagged `highway=secondary`, `surface=asphalt`, generally `lanes=2`. Do not build the route merely by matching the name: other residential streets in Dionysos share that name.

Ordered OSM ways from town start to fork (reverse the OSM node ordering for each): **127528594 → 124519741 → 124518687 → 124517416 → 127528596 → 127528595**, followed by the short end segment of **224029663** to node 278007766.

From the fork toward Penteli, reverse ways **838986165 → 124517366 → 224029848**, ending at node 3657221927 near Karakanta. The complete EP5 road geometry already exists in the raw extract, even where a way extends outside the originally requested XML bounding box.

**Fork correction:** GeoNames-derived map results place “Agios Petros” near 38.07270, 23.93252. That is west of the actual OSM chapel and junction. Use the OSM fork coordinates above for routing and Street View searches.

## Direction and misleading alternatives

At Agios Petros, continue east/northeast on EP29 for Nea Makri and subsequently Marathon: this goes toward the coastal plain and is predominantly a descent. Turn **right/southwest** onto EP5 for Penteli: this is the climbing continuation. The local runners' direct driving instructions independently describe exactly this right turn when approaching from Dionysos, followed by 5.5 km to a high parking area. [Athens HHH directions](https://www.athenshash.com/Main_HTML/resources-hare.htm).

Do not imply that Dionysos → Marathon, in that direction, is a sustained hill climb. The real car hill climb called “Anavasi Dionysou” and routes approaching Agios Petros from coastal Nea Makri are distinct from a Dionysos-town start. The 2019 PEPA cycling event names Dionysou × Aetorachis as its start, Agios Petros church as its finish, and a distance of 7.5 km. That named start must not be assumed to be in Dionysos town; a Nea Makri-side start is plausible, but Aetorachis was not independently geocoded during this research. [PEPA event announcement](https://www.pepa.gr/index.php/topics/topic/1839). The motor event organizer describes a 5 km stage on the northeastern Penteli slope, which supports road-racing context but does not establish our selected stage as that official course. [Organizer 2023 event page](https://www.ellada-racingclub.com/about-1).

Rapentosa quarry/waterfall shortcuts are a different corridor with tracks, stream crossings and descent into the Dariza valley. A route through Rapentosa does not automatically remain on the paved through-road. Ntrafi/Drafi and Ntaou Pentelis are southern/eastern settlements and belong to a different route around the mountain; routing via them would drift away from the north/back Dionysos approach. Keep quarry access roads as scenery or optional branches, not as the racing line. The Municipality of Penteli explicitly distinguishes asphalt on the Penteli–Agios Petros corridor from its separate dirt-road/singletrack mountain-bike routes. [Municipal mountain-bike routes](https://penteli.gov.gr/%CE%BF%CF%81%CE%B5%CE%B9%CE%BD%CE%AE-%CF%80%CE%BF%CE%B4%CE%B7%CE%BB%CE%B1%CF%83%CE%AF%CE%B1-mountain-bike/).

## Data and provenance

`raw/osm.json` contains **110,191** OSM nodes/ways/relations (approximately 11 MB), converted from primary OSM API XML into an Overpass-compatible JSON shape. It includes roads, land use, vegetation polygons, buildings, quarries, streams, places and the chapel. Original XML was fetched by the parent agent at `.scratch/penteli/osm-api.xml` with bbox **23.867,38.068,23.935,38.115**.

Broader requested bbox: south 38.025, west 23.85, north 38.14, east 23.99. Overpass attempts timed out. OSM API map calls successfully fetched northwest, northeast and southeast quadrants; the southwest quadrant exceeded the API density limit. `osm3s.coverage_note` records this limitation. The selected Dionysos-to-spring road has complete geometry and no missing referenced road nodes. Adjacent scenery in the far southwest remains incomplete.

Primary endpoint: `https://api.openstreetmap.org/api/0.6/map?bbox=west,south,east,north`. Attribution/license: [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright). Chapel/spring coordinates also verified through [OSM Nominatim](https://nominatim.openstreetmap.org/).

Elevation queries used the public [OpenTopoData SRTM90m API](https://api.opentopodata.org/v1/srtm90m?locations=38.0944623,23.8940002%7C38.0719843,23.9345426%7C38.0670148,23.9008502). Preserve real terrain undulations instead of forcing all heights to rise.

Satellite context is at `.scratch/penteli/satellite.jpg`, **1600 × 1164**, bbox **west23.886,south38.06,east23.941,north38.10**, both bbox and image spatial reference EPSG:4326. Download source: [Esri World Imagery export](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=23.886%2C38.06%2C23.941%2C38.10&bboxSR=4326&imageSR=4326&size=1600%2C1164&format=jpg&f=image). This is a visual reference; its capture date and imagery-provider-specific attribution have not been established, so it should not be represented as dated 2026 imagery or used to assert precise current fire boundaries.

## Fire / vegetation evidence

The municipality's report dated **15 August 2024** describes the fire entering from Dionysos and climbing Penteli's northern side. This supports broad fire-affected scenery in the northern mountain context, but supplies no reliable polygon for each roadside scar. [Municipality of Penteli fire chronology](https://penteli.gov.gr/xroniko_fotias/).

NASA's **3 September 2024** publication shows the regional burn scar in a Terra MODIS false-color image captured **24 August 2024**. Its resolution is suitable for regional context, not precise roadside placement. [NASA MODIS burn-scar report](https://modis.gsfc.nasa.gov/gallery/individual.php?db_date=2024-09-03).

Use sparse shrubs, exposed ground and mixed recovering vegetation as a general visual treatment where supported by imagery. Do not label manually guessed polygons as actual 2024 fire scars. Detailed scar boundaries require georeferenced dated post-fire evidence, such as Copernicus EFFIS/Sentinel imagery, which was not retrieved in this research.
