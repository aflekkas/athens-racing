# Riviera landmark reconstruction

Research date: 2026-10-14. Coordinates are WGS84 latitude/longitude; world metres use `data/map.json` projection. Google Street View (April 2026), public first-person photographs and primary OSM geometry were inspected; images are reference-only, not shipped textures.

## Karamanlis / Loumbarda twin tunnels

These are **beyond Varkiza near 37.8146 N, 23.8336 E**, not at the Limanakia coves (route mark s=2318). They lie within the existing Vouliagmeni–Lomvarda route, approximately s=9428–9503; no route extension is required.

- East bore: [OSM way 25371523](https://www.openstreetmap.org/way/25371523), approximately 23.2 m; coordinates 37.8145663,23.8337928 → 37.8147739,23.8337579.
- West bore: [OSM way 172988026](https://www.openstreetmap.org/way/172988026), approximately 51 m; curved alignment from 37.8148408,23.8336026 to 37.8144183,23.8334038. Module orders points by increasing race distance, opposite the OSM one-way direction.
- Both ways are `primary`, `lanes=2`, `oneway=yes`, `tunnel=yes`, `layer=-1`, `maxspeed=50`. Live OSM API copies and saved source geometry agree on the portals. Files: `.scratch/world-playtest/refs/osm-way-{25371523,172988026}.json`, `tunnels-osm.json`.
- [Hellenic Police, 28 October 2020](https://www.astynomia.gr/2020/10/28/28-10-2020-kykloforiakes-rythmiseis-sti-l-athinon-souniou-logo-ektelesis-ergasion-sti-siranga-loubarda/) confirms the named tunnel and two directional carriageways (roadworks diversion; not a current traffic rule).
- [Google Street View, April 2026](https://www.google.com/maps/@?api=1&map_action=pano&pano=4ogSMsTj1LpnKOYOsKmGrw): inspected inside the east bore at 37.814599,23.8337941. Raw rock walls and rounded ceiling, two same-direction lanes, white lane markings and narrow yellow raised kerbs. Native browser capture: `.scratch/world-playtest/refs/streetview-east-portal.png`.
- [Dimosf, photographs taken 14 December 2015](https://disaki.blogspot.com/2015/12/blog-post_15.html): inspected both portal faces and surrounding coast. Irregular exposed limestone, separate unequal bores, bare rock central pier, guardrails and street lights. Reference copies: `.scratch/world-playtest/refs/dimosf-{0,3,5,7}.jpg`, URL manifest beside them. These predate 2020 repairs; they establish basic landform, not present-day signs or barrier details.
- [Technical Chamber of Greece bulletin, 2 November 2020](https://web.tee.gr/wp-content/uploads/newsletter/2020/11/NEWSLETTER20201102.pdf) documents rock removal and approach gabions during repair.

`src/maps/riviera-tunnels.js` stores the exact saved axis coordinates. The 8 m carriageway width is an explicit two-lane reconstruction, **not a surveyed OSM width**. Portal clearance and rock profile are visual estimates from photographs. Road/contact and scenery must share the same layout; the old averaged route crosses the physical rock pier and cannot accept a solid decorative tunnel unchanged.

## Limanakia coves

[Municipal tourism authority](https://www.visitvarivoulavouliagmeni.gr/index.php/en/city-networks/item/168-limanakia) identifies the rocky coves between Vouliagmeni and Varkiza, steep walking access and pale coastal cliffs. This supports rocky shore context; it does not establish a road tunnel there. Existing roadside kiosks/steps remain; no invented tunnel is added at that mark.

## Implementation and validation scope

`src/riviera-landmarks.js` consumes the runtime `route.localCorridors` axes, builds two rock shells (2,340 triangles total), joins their shared rock pier, and registers 134 wall boxes outside the clear openings. `ground.constrainCamera(position, anchor)` mutates the desired camera position and returns whether it was constrained. Main's camera owner excludes cockpit, photo and replay cameras. Geometry shares existing rock textures and participates in scenery LOD.

The Penteli terrain fix samples the exact rendered triangle instead of a bilinear patch. A production-mesh sweep checked 15,258 near-road, off-network triangle centroids: the previous contact error reached -0.544440 m at s=6003.4083, u=16.7857 (world x=2983.3333, z=1006.6667) and +0.668484 m elsewhere; corrected error is below 6e-13 m. This is terrain contact evidence, not a claim to fix the separate on-road launch issue owned by handling.

Artifacts in `.scratch/world-playtest/`:

- `loumbarda-{before,after}.png`, `loumbarda-interior.png`: native-browser isolated shells on production corridor axes, with simplified road ribbons. No full-game terrain/postprocessing is shown.
- `penteli-contact-{before,after}.png`: actual production terrain mesh crop and contact-height marker. These illustrate the measured mismatch; they are not a full vehicle fallthrough replay.
- `landmark-proof.json`: 285 clear driving positions, 570 side-clearance rays, 134/134 solid rock wall contacts and camera crown occlusion. CPU geometry/contact test using actual Three.js and Ground.
- `landmark-browser.json`: isolated rendering changed 2 to 4 draw calls. Median render-call wall time was 0.2 ms before and 0.1 ms after (20 samples each, 1280×800; individual samples 0–1.7 ms). These values are too close to timer resolution for a useful performance claim. This does not establish a full-game FPS gate.
- `terrain-contact-{before,after}.json`: coordinate-level production mesh/contact sweep.

All five comparison images and the source imagery were opened and visually inspected. The current browser job is deliberately limited to these local fixtures; historical full-map performance captures remain in `.scratch/world-v3/`.
