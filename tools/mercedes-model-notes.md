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


## Curvature and silhouette revision (14 October 2026, round 3)

GLA 45 S now has a low, wide Panamericana opening, swept lenses projected onto the bonnet, rounded bumper corners, wider visible arch bands, and a rising side-window sill over the rear wheel. Its roof rolls down into a raked hatch. CLA remains obsidian black, with an arched four-door coupe roof, higher belt, narrower curved glasshouse, shorter visible nose corners and slim connected star lights. CLE has a continuous roof arch, long rear pillar sweep, uninterrupted side glazing without the opaque B-pillar, two bonnet power domes, multi-spoke wheels, and slimmer rear lights wrapping around the quarters. All three have deeper waist curvature and tighter wheel-arch gaps; published body dimensions and the physics catalogue are unchanged.

The CLE door mirror sits 100 mm further aft to clear the raked A-pillar; the mount still uses the shared actual-body-surface attachment. Curved A-pillar trim follows the glass rather than cutting across it. Dark rear glazing is retained in the traffic road LOD, with a regression check for all four Mercedes. The basic GLA's body geometry was preserved.

Additional shape sources: the manufacturer's C174 brochure at https://media.mercedes-benz.fr/download/a39ec976-adb6-4310-a492-951866f5b9e5/brochure-cla-c174-29-04-2025.pdf and a Mercedes dealer-hosted manufacturer side photograph at https://s3-sxb.aci-cloud.com/prod/mercedes-kroely/sections/CLA_gallerie_3_960263800.webp (page https://www.mercedes-kroely.fr/gammes-mercedes-benz/cla-2025). The red electric CLA photograph references the shared glasshouse, while the existing hybrid press images reference the nose/grille. All downloaded source files and URL mappings stay in `.scratch/models-merc/refs/`.

Evidence: `.scratch/models-merc/round3/{gla45,cla,cle}-comparison.png`, corresponding `*-overlay.png`, individual front/rear/side/interior renders, `silhouette-metrics.json`, and capture scripts. Each sheet was opened and reviewed. The overlays align two wheel centres using uniform scale and rotation only. Manually traced photo landmarks give maximum residuals as percentages of projected car length:

| Model | Roof | Window sill | Front/rear ends |
|---|---:|---:|---:|
| GLA 45 S | 2.81% | 0.46% | 2.66% |
| CLA | 2.67% | 1.84% | 0.97% |
| CLE | 2.21% | 1.26% | 3.12% |

These are image-space comparisons, not manufacturer CAD tolerances: lens, camera perspective, tyre contact and hand tracing limit accuracy. Honest remaining differences: bumper-to-quarter transitions and lamp internals are still more angular/simplified than the press cars; the CLE rear end remains the largest outline residual. Roof and beltline proportions are substantially closer than the prior slab-sided versions. Studio captures use the small model harness; no additional full-world boot was needed for this revision.

Scoped private-index CAS checkpoints: `fc04fb3` (GLA 45), `f746cc3` (black CLA), `9c5ecff` (CLE), `c41ab4f` (GLA rear sill and retained tinted road glass), and `d257181` (remove an unreachable branch accidentally duplicated while assembling the previous private-index patch). The shared index, multiplayer implementation, pushes and deployment were not touched.

Validation logs in `round3/`: full vehicle suite 3,989 assertions, focused revised-car checks 448, physics regression 108, `npm test` 164 tests across its two stages, and `tools/*.test.mjs` 209 tests. Drift checks pass for all four Mercedes and all four driver-feel sweeps complete. The subsequent Mercedes traffic run passes 87 assertions, including four new tinted-glazing regression checks. No engine, drivetrain, gear, tyre-grip or suspension physics value changed.

## R231 SL 65 AMG roadster (15 October 2026)

`sl65` represents the pre-facelift 2012–2016 R231 with its retractable hardtop stowed. The body uses a separate SL contour within the Mercedes builder: long twin-dome bonnet, swept projector lenses, horizontal twin-blade grille and large star, chrome bonnet/wing gills, two-seat open cockpit, rear deck lip, triangular rear lights and four rectangular exhaust outlets. Dark multi-spoke 19-inch game wheels retain the staggered 255/35 R19 front and 285/30 R19 rear tyres. The COMAND-era cockpit has four turbine vents, two analogue AMG dials, an integrated centre display and a console selector. The roof is permanently down; there is no roof animation or active ABC simulation.

- Mercedes launch engine, gearbox, performance, EC mass, tyres, paint and design references: https://media.mercedes-benz.pl/moc-bez-wysiku/ and https://media.mercedes-benz.fr/nouveau-sl-65-amg---maitrise-et-style-dans-la-performance/
- Manufacturer 2014 brochure (dealer-hosted), including EC mass definition and period colour palette: https://www.baaf-ks.com/upload/models/slclass/brosure/slclassr231_brosur.pdf
- Manufacturer front and rear visual references: https://content.presspage.com/uploads/1896/1920_896895-1683114-6048-4032-p2-sl-65-amg-2.jpg and https://content.presspage.com/uploads/1896/800_896901-1683131-6048-4032-12c181-018.jpg . Reference photographs are not shipped assets.

M279 5980 cc twin-turbo V12: 463 kW / 630 PS at 4800–5400 rpm and 1000 Nm at 2300–4300 rpm. Seven-speed AMG SPEEDSHIFT PLUS 7G-TRONIC, RWD. The catalogue uses 1875 kg DIN (1950 kg EC less the specified 75 kg driver/luggage), 4.631 × 1.877 × 1.314 m and 2.585 m wheelbase. The standard **250 km/h limiter** is used, rather than the optional 300 km/h Driver’s Package. The garage quotes the manufacturer's 4.0 s 0–100 figure. As with every other catalogue car, the game's global automatic/manual preference remains available.

Off-peak torque, shift time, axle load distribution, drag with the roof down, tyre friction, LSD locking and suspension/aids are gameplay calibrations. The 19-inch multi-spoke design is an approximation; the launch brochure's optional forged package pairs a 19-inch front with a 20-inch rear, while its standard 19-inch package uses five spokes. Paint swatches approximate Diamond White, Obsidian Black, Iridium Silver, Palladium Silver, Mars Red and designo Magno Allanite Grey; the magno finish uses the existing matte-paint material settings.

Headless flat-road bench: 0–100 4.40 s, 0–200 11.23 s, terminal 249 km/h, 100–0 32.7 m. These are simulated results, separate from the quoted launch performance. Skidpad is 0.96 g with 3.06 deg/g understeer. All six existing SL-only drift checks pass: aided power rotation stays at 5.8 degrees without latching the drift helper, and aids-off power oversteer holds a 32-degree slide for 7.7 seconds. The heavy front-engine GT has lower handling stats and greater yaw inertia than the Z4/Carrera/Huracan.

Verification evidence is saved outside the repository in `/tmp/cars-sl65/`: `studio-{front,rear,side,interior}.png`, `car-select.png`, `garage.png`, `chase.png`, `drive.json`, `studio-metrics.json`, `initial-errors.json`, `bench.log`, `handling.log`, `drift.log` and `npm-test-final.log`. All captures use a headless browser and the game server on port 8101. The server is stopped after verification. The vehicle checks include open-roof, staggered-tyre, RWD/V12, four-exhaust, paint, wheel, damage/repair and finite-geometry coverage.

Two test-environment issues were encountered: macOS `/var` versus `/private/var` temporary-path aliases bypass the existing browser bundler's source-URL rewrite, so the full test run uses `TMPDIR="$PWD/.scratch/sl65/tmp"`; a stored automatic physics trajectory differs by floating-point roundoff on this Mac (reproduced on Node 22 and 25). The stored trajectory check now allows a 1e-12 relative tolerance, while the live default-versus-explicit automatic comparison remains bit-exact. No shared physics or bundler implementation changes are included.

Final results: `npm test` passes 266 tests with one skip and zero failures. A fresh studio fixture passes 237 vehicle assertions (SL plus CLE/GLA/GLA45/CLA), 30 SL mirror assertions, 23 SL traffic assertions and three SL player-budget assertions. Player visible triangles are 54,962 / 11,228 / 1,024 at 5 / 20 / 100 m; traffic near/far are 12,826 / 2,862. `vehicle-checks.json` and `validation.log` retain these results. The final real-game keyboard run reaches 72.6 km/h in third and moves over 40 m; `initial-errors.json` is empty. The gallery, garage, chase and all four studio images were opened and reviewed.
