# Mercedes playable fleet

Original procedural meshes in `src/player-mercedes.js`, metres, nose -Z. Photographs are visual references only; no downloaded photograph, logo or mesh is shipped as a texture. The cockpit badge is drawn procedurally. These are reference-proportioned game models, not manufacturer CAD.

| ID | Version | Drive | Mass used | Rated output | Transmission | L × W × H / wheelbase (m) |
|---|---|---|---:|---|---|---|
| `cle` | C236 CLE 300 4MATIC | AWD | 1805 kg DIN | 190 kW / 400 Nm | 9G-TRONIC | 4.850 × 1.861 × 1.428 / 2.865 |
| `gla` | H247 GLA 200 Progressive, non-48V market | FWD | 1485 kg | 120 kW / 250 Nm | 7G-DCT | 4.410 × 1.834 × 1.611 / 2.729 |
| `gla45` | H247 AMG GLA 45 S 4MATIC+ | AWD | 1765 kg EU | 310 kW / 500 Nm | AMG 8G-DCT | 4.443 × 1.849 × 1.590 / 2.729 |
| `cla` | New-generation CLA 200 hybrid | FWD | 1713 kg kerb | 135 kW / 330 Nm system | 8G-eDCT | 4.723 × 1.855 × 1.450 / 2.790 |

The new CLA hybrid is **C178**; C174 is the electric sister model. This model uses the new 2025 body and star-pattern grille/light signatures, not the outgoing C118. Obsidian black is its default paint. GLA 200 deliberately uses the documented Philippine non-48V specification, rather than combining its mass with the European mild hybrid's 270 Nm rating. The CLE mass is a representative DIN conversion of the linked later technical sheet's 1880 kg EU figure; equipment and model-year masses vary.

## Sources and references

- CLE launch dimensions, shape, drivetrain and photographs: https://media.mercedes-benz.fr/decouvrez-la-nouvelle-mercedes-benz-cle/
- CLE technical drawing and mass: https://nd-mediagallery2-public-production.s3.amazonaws.com/215df8a0a2f426ec8e82796a0eaca795/techdata_cle_c236_806_056.pdf
- GLA 200 engine, dimensions, weight and photographs: https://www.mercedes-benz.ph/media/enodlijs/mercedes-benz-gla-mb-ph-ebrochure-feb2024.pdf
- GLA 45 S manufacturer press kit and photographs: https://media.mercedes-benz.fr/le-nouveau-mercedes-amg-gla-45-s-4matic--un-suv-performance-compact-pour-toutes-les-circonstances/
- GLA manufacturer brochure, dealer-hosted: https://www.mercedesonlease.co.uk/wp-content/uploads/2021/12/GLA-Brochure.pdf
- H247 dimension drawings: https://nd-mediagallery2-public-production.s3.amazonaws.com/996084168afb8d66072da1d7745944de/techdata_gla_h247_805_055_20240806.pdf
- New CLA hybrid launch and photographs: https://media.mercedes-benz.fr/high-tech-electrifie-efficient--le-tout-nouveau-cla-hybride-est-desormais-disponible-sur-commande/
- CLA system output: https://media.mercedes-benz.com/article/2cbb1f31-888b-4912-b201-793d8eb2bb26
- CLA UK technical data: https://www.mercedes-benz.co.uk/passengercars/models/saloon/cla/overview.html

Downloaded press reference photographs, PDFs and exact photograph URLs are in `.scratch/models-merc/refs/`; `photos.json` maps each JPEG to its source URL. Paints are approximate screen swatches, not measured paint samples.

## Implementation and limits

Four distinct parameter sets share a Mercedes shell builder: long two-door CLE, tall four-door GLA, AMG wide arch bands/Panamericana bars/quad exhaust, and lower CLA with panoramic black roof, grille stars and star lamps. Solid roof lining and pillars enclose separate glass panes. Mercedes cockpit details include turbine vents, ambient trim, column selector, CLE portrait screen and CLA passenger display. The existing driver, independent wheel/suspension transforms, three optical mirror cameras, fictional Greek plates, paint persistence, lamps, detachable parts and deformation lattice are retained. The regular player three-level LOD path also makes the bodies usable by traffic systems.

Rated power/torque and dimensions come from the sources above. Off-peak torque curves, static load distribution, friction, suspension, drag area and shift times are simulation calibrations. GLA 200 and new CLA individual gear/final-drive ratios were not available in the cited primary sheets: their overall ratios are explicitly estimates. Hybrid output is represented by one combined curve without battery state-of-charge simulation. AWD rear fractions and deliberate-slide assistance are game parameters, not implementations of factory torque-vectoring software.

The multiplayer Node server reads car IDs from `CARS`; `tools/prepare-deploy.mjs` derives the Worker catalogue from the same list. The multiplayer acceptance regression explicitly includes all four new IDs. No separate hard-coded production whitelist requires duplication.

## Verification artifacts

Each car's front three-quarter, rear three-quarter, side, cockpit and on-road chase views live in `.scratch/models-merc/`. Reference/render comparison sheets are `<id>-comparison.png`; raw views are `<id>-front.png`, `<id>-rear.png`, `<id>-side.png`, `<id>-interior.png` and `<id>-chase.png`. `mirrors-fp/` contains real-game first-person captures.

`mercedes-checks.json` records geometry, player budgets, painted/damaged/repaired mirror attachment and cockpit optical checks. `drift-<id>.log`, `feel-<id>.json`, `regress-final.log`, `npm-final.log` and `tools-tests.log` hold the dynamic and unit-test evidence. Passing regression envelopes establish stable game behaviour, not instrumented real-car equivalence.

Mercedes-only geometry/cockpit/part checks passed 597 assertions; the fleet checks passed another 83. Actual traffic near meshes measure 18,496 / 18,604 / 19,372 / 19,648 triangles (CLE / GLA / AMG / CLA), with 2,542-triangle far meshes. All four drift runs passed applicable checks, and all four driver-feel sweeps completed. The full physics regression passed 108 checks; `npm test` passed 93 tests. A later `tools/*.test.mjs` snapshot passed 94/96, with unrelated Riviera/Penteli road-network reproducibility failures. Full vehicle-suite snapshots also reported concurrent Carrera traffic-budget, MINI traffic mirror attachment, MINI JCW FOV and Ibiza bumper-part failures; see `all-vehicle-final.log`. These are not Mercedes failures.

The normal `*-chase.png` and `mirrors-fp/` road captures use the game's low graphics tier (which intentionally disables reflected render targets). `optical-road/mirrors-fp/` holds a separate medium-tier run with three live reflection targets per car. Capture scripts and numerical optics metadata are retained alongside the screenshots. Nothing was pushed or deployed.

## H247 silhouette correction (14 October 2026)

The GLA bodies now use a five-door hatch envelope instead of the coupe backlight/deck construction: the roof edge extends 0.50 m rearward, the rear glass runs only 0.385 m longitudinally and ends at 1.17 m above ground, and a separate curved quarter-light, broad rear pillar and sloping tailgate shoulder fill the rear quarter. Bumper surfaces roll inward vertically as well as around their corners; lamps, grille bars, plate carriers and exhaust outlets follow the same projection. The hatch shoulder remains in the detachable boot group, and the simplified rear glass retains the raised hatch sill.

The AMG has sculpted fender shoulders around both axles, wider arch bands, dark ten-spoke 20-inch wheels and red fixed calipers. The basic Progressive uses the brochure's 19-inch wheels and 235/50 R19 tyre label (also listed in the [Mercedes H247 2024 wheel table](https://nd-mediagallery2-public-production.s3.amazonaws.com/2925aea29951c2de6bd34196724709f8/2024_10_h247_15.10.2024_gla_ee.pdf)). Visible tyre radii are 0.358 m (GLA 200) and 0.356 m (45 S); the existing 0.346 m effective rolling radius in the physics calibration is retained. Rear wheel centres now use the published 1.606 / 1.590 m rear tracks rather than copying front track. Engine, transmission, grip and suspension calibration did not change.

Visual references for this pass are Mercedes press images `20c0325-008.jpg` (side) and `20c0325-002.jpg` (rear-quarter), plus the GLA 200 Progressive rear photograph extracted from page 3 of the Philippine brochure. Exact URLs are in the source comments and `.scratch/models-merc/refs/photos.json`; none are game textures.

Revised matched-angle comparisons, individual views, normal real-game chase captures and logs are in `.scratch/models-merc/h247-revision/`. `gla-comparison.png` and `gla45-comparison.png` pair manufacturer views with the new geometry. `cle-cla-preserved.json` compares every assembled mesh's position buffer and transform before/after the Mercedes-builder edit: both CLE and CLA hashes are identical, including their original dimensions.

The full vehicle suite passes 3,875 assertions. The focused suite passes 609 assertions, including 12 new hatch/stance/bumper checks, plus 83 traffic-fleet assertions and 96 traffic/player mirror assertions. GLA traffic near meshes are now 16,362 / 17,642 triangles; the far/parked meshes remain 2,542 / 2,974. Physics regression passes 108 checks; all four Mercedes drift runs pass applicable checks and all four driver-feel sweeps complete. `npm test` passes 105 tests; `node --import ./tools/physics-test/register.mjs --test tools/*.test.mjs` passes 118. The loader is necessary for the Three.js physics imports in the damage test. This follow-up does not change multiplayer, push or deploy.
