# Psychiko realism — implementation F

Worktree: `/Users/vassilisperrotis/.t3/worktrees/athens-street-racers/psychiko-realism`, branch `vas-per/psychiko-realism`. Baseline **e99e37c1**. No push, PR, deployment, staging or production changes. All browser jobs use Chromium headless shell through the repository-compatible advisory browser-slot wrapper. The wrangler command below is a dry run only.

## Changes and source evidence

The inherited implementation is retained: **23 house sections**, six Faros commercial footprints, 206 parking stations / 412 opposing Street View panes and 217 positive lap-side parking intervals. Numeric observations live in `tools/maps/psychiko/raw/house-styles.json` and `parked-cars.json`; source panorama metadata is in [implementation E](../impl-e/references/stations.json). These are approximate observations of street character, heights, colours and occupancy, not measured elevations or a vehicle census.

Faros has two- and three-storey pale shops, glazed ground floors and upper windows, cream projecting awnings, blue/terracotta fascia and simple sign strokes. The 76 m junction apron excludes generated garden boundaries and trees; planting resumes outside it. Wide pavement islands, signal poles and arms, trolley wires and low steel race separators remain. Separators are game course boundaries, not assertions about permanent real-world closures.

**Facade fix:** the apparent rubble texture was an atlas indexing error. An interpolated style of 4 could arrive fractionally below 4; `floor(style/4)` and `mod(style,4)` then selected the wrong tile. The shader now rounds the style before atlas lookup. Faros shops use clean commercial style 5. Boundary stone remains confined to explicitly marked wall vertices. A headless GPU fixture tests exact and ±0.000002 style values at styles 4 and 5: all six renders are byte-identical to their corresponding exact-style render. All 28 building cells are checked for material isolation; all 311 frontage records are tested independently for zero stone/cutout weights. The College wall is the positive control. [Capture and GPU audit](harness/evidence-after.json), [focused tests](focused.log).

Houses retain all **3,647 OSM footprints** and the original route, with white, cream and pale ochre render; section-specific storeys, window pitch, balconies, flat roof parapets, occasional pergolas and tiled roofs. Explicit OSM heights are preserved outside the listed landmark corrections. Pale front walls, hedges, stone College boundaries and iron park fencing follow the section survey. Shells keep the existing shared atlas and cell batches; frontage details share streetscape cells, with no new per-building draw calls. [Section-by-section audit](world-audit.json), [scope proof](scope-proof.json).

Parking uses **394 instances in one fleet**: 357 on the lap and 37 on the surveyed Solomou side street / opposite Faros approach. There is no unsurveyed side-street fallback. Neutral white/silver/grey/black dominates, with fewer blue/red cars and one yellow taxi near Faros/Kifisias. The five opposite-approach vehicles are a standing signal queue, not a claim of permanent parking. The generator protects junctions, crossings and arms; the runtime checks full body corners against the racing surface and islands and avoids tree pits. Minimum measured lap-body racing clearance: **0.643 m**; crossing centre separation **6.30 m**; roundabout arm station separation **25.02 m**. [Parking audit](world-audit.json), [coverage map](parking-coverage-map.webp), [coverage data](parking-coverage.json).

## Pictures

**39 before / after / Street View comparisons**, in lap order, using e99e37c1 for Before, the final production world for After, and the same snapped panorama coordinates, heading, 90° horizontal FOV and approximately 2.5 m eye height. Faros has eight distinct views, including five extra directions around the start/return. One duplicate lap-0018-extra capture was removed. Every displayed reference pane is labelled **Street View © Google · reference only**. Source imagery is never a build input and is absent from `assets/`; only labelled comparison evidence is retained under `.scratch/`. Raw downloads and duplicate capture frames are discarded after composition. [Baseline provenance](baseline-provenance.json), [comparison index](comparisons.json).

[Review gallery](review.html) · [comparison contact sheet](contact-sheet.webp) · [game screenshot contact sheet](screenshots-contact-sheet.webp)

[faros-across](sbs-faros-across.webp) · [faros-across-extra](sbs-faros-across-extra.webp) · [lap-0000](sbs-lap-0000.webp) · [lap-0000-extra](sbs-lap-0000-extra.webp) · [lap-0018](sbs-lap-0018.webp) · [lap-0028-extra](sbs-lap-0028-extra.webp) · [lap-0045-extra](sbs-lap-0045-extra.webp) · [lap-0090](sbs-lap-0090.webp) · [lap-0360](sbs-lap-0360.webp) · [lap-0390](sbs-lap-0390.webp) · [lap-0675](sbs-lap-0675.webp) · [lap-0990](sbs-lap-0990.webp) · [lap-1035](sbs-lap-1035.webp) · [lap-1350](sbs-lap-1350.webp) · [lap-1552](sbs-lap-1552.webp) · [lap-1710](sbs-lap-1710.webp) · [lap-1800](sbs-lap-1800.webp) · [lap-1980](sbs-lap-1980.webp) · [lap-2138](sbs-lap-2138.webp) · [lap-2340](sbs-lap-2340.webp) · [lap-2565](sbs-lap-2565.webp) · [lap-2745](sbs-lap-2745.webp) · [lap-2970](sbs-lap-2970.webp) · [lap-3150](sbs-lap-3150.webp) · [lap-3240](sbs-lap-3240.webp) · [lap-3465](sbs-lap-3465.webp) · [lap-3645](sbs-lap-3645.webp) · [lap-3780](sbs-lap-3780.webp) · [lap-4005](sbs-lap-4005.webp) · [lap-4060](sbs-lap-4060.webp) · [lap-4140](sbs-lap-4140.webp) · [lap-4455](sbs-lap-4455.webp) · [lap-4635](sbs-lap-4635.webp) · [lap-4905](sbs-lap-4905.webp) · [lap-5040](sbs-lap-5040.webp) · [lap-5085](sbs-lap-5085.webp) · [lap-5310](sbs-lap-5310.webp) · [lap-5580](sbs-lap-5580.webp) · [lap-5715-extra](sbs-lap-5715-extra.webp)

The 11 clean full-game images below are **1600 × 1000 WebP**, encoded at quality 0.85. They use the production game, Mini car, day/clear conditions, fixed driver/chase poses and world detail On; menus/HUD are absent for the clean picture. These are still renders of a stationary car at route positions, not frames claimed to be from the physical AI drive.

- [01-faros-driver](screenshots/01-faros-driver.webp)
- [02-faros-chase](screenshots/02-faros-chase.webp)
- [03-proti-plateia](screenshots/03-proti-plateia.webp)
- [04-diamantidou](screenshots/04-diamantidou.webp)
- [05-paraschou-descent](screenshots/05-paraschou-descent.webp)
- [06-college-wall](screenshots/06-college-wall.webp)
- [07-benaki](screenshots/07-benaki.webp)
- [08-michalakopoulou](screenshots/08-michalakopoulou.webp)
- [09-kallari-park](screenshots/09-kallari-park.webp)
- [10-kifisias](screenshots/10-kifisias.webp)
- [11-diamantidou-chase](screenshots/11-diamantidou-chase.webp)

The physical lap check now rejects **any positive wall-hit impulse**, rather than ignoring impulses below 1 m/s. The development lap still completes all six rings in 502.667 s with zero off-road, island, clockwise or wall-hit frames and a maximum wall-hit impulse of exactly zero. The same strict check is rerun in the clean archive.

## Measurement and gates

The fixed Low/High poses, production render settings and Mini day/night chase/cockpit cameras are identical to implementation E. The game capture resets terrain LOD history before each measurement; source hashes are retained with the results. Performance figures are renderer draw/triangle counters under SwiftShader, not FPS claims. The wider 1600 × 1000 gallery and comparison poses are additional views, not the budget cameras.

| Camera | Calls before → after | Triangles before → after | Limit |
| --- | ---: | ---: | ---: |
| Low · matched | 69 → 68 | 742,178 → 742,703 | 909,000 |
| Low · Faros | 166 → 165 | 1,430,751 → 1,428,179 | 1,600,000 |
| High · matched | 81 → 82 | 846,421 → 869,894 | 935,000 |
| High · Faros | 192 → 190 | 1,644,785 → 1,638,149 | 1,700,000 |
| Game · day-chase | 79 → 79 | 738,647 → 751,322 | 821,000 |
| Game · day-cockpit | 78 → 78 | 734,891 → 747,566 | 821,000 |
| Game · night-chase | 81 → 81 | 739,607 → 752,282 | 821,000 |
| Game · night-cockpit | 80 → 80 | 735,851 → 748,526 | 821,000 |

[Budget assertions](budget-results.json) · [Low/High source-hashed measurements](harness/perf-final.json) · [matched full-game measurements](detail-fixed.json) · [current-course detail measurements](detail-current.json)

The matched High triangle increase remains below the supplied ceiling, and all matched draw counts are within the approximately 10% allowance. Earlier counters for other maps are retained because their map inputs and geometry are unchanged; the shared atlas rounding changes no topology, culling, resources or passes.

## Remaining differences

- Houses are still simplified OSM blocks. Section colours, heights and roof types are closer, but window rhythm and balcony details repeat; distinctive villa ornament, individual driveways, exact garden setbacks and roof equipment are not all reproduced. Ground-floor exposure still follows the existing terrain support on sloped parcels.
- Faros preserves the open commercial character, but shop interiors, brands/lettering, exact awning spans, stepped rooflines and pole/cable attachment positions are approximate. Signals are static dressing. The red start gantry and race closures are game furniture.
- Parked cars use estimated occupied kerb intervals and seeded gaps within them. They are simple shared car bodies, not an exact count, make, orientation or timestamped placement of each photographed vehicle. Safety clearance removes some real-world parking near crossings and mouths. The signal queue is kept distinct from the permanent parking survey.
- Trees and hedges use the existing stylised meshes and approximate density, not individual photo-matched trees. Some reference views have much denser vegetation and more visual enclosure.
- Panorama snapping, OSM alignment, different source seasons/dates, the smoothed Copernicus terrain and omitted Kifisias tunnel context remain the limitations described in [implementation E](../impl-e/README.md) and [D](../impl-d/README.md).

## Reproduction and evidence

The two builder runs are byte-identical across route/profile, `map.json`, `terrain.bin` and the preview SVG: [hashes](rebuild-hashes.json), [rebuild script](rebuild.mjs), [log](rebuild.log). No other map bundle changed. The atlas fix changes sampling arithmetic only, with no additional shader passes, textures or draw calls.

Headless captures: [station harness](harness/evidence.mjs), [Low/High harness](harness/perf-browser.mjs), [game harness](game-capture.mjs), [composition](compose.py), [gallery](gallery.py), [browser-slot fallback](browser-slot.py). Re-running station composition requires refetching the source reference URLs in `capture-stations.json` and recapturing the e99e37c1 baseline; the original raw files were intentionally removed after composition. Use a fresh task temporary directory in `session.json` for any new run. [Gallery preview check](inline-preview-check.json), [removed duplicate/raw evidence](removed-capture-files.json).
