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
