# Psychiko recognition — implementation E

Continues the inherited `72ac5c56` survey and unfinished implementation. Visual/performance baseline: `c4df524e`. Work stayed on `vas-per/psychiko-realism` in the requested worktree. No push, PR, staging change or deployment. All browsers were headless; Street View retrieval used HTTP only.

## Survey and coverage

**206 stations / 412 reviewed panes**, in both directions: the original 165 stations at 45 m intervals and named junctions, plus 41 additional public-junction positions. The 89 distinct public lap/ring junction nodes are each within **5.91 m** of a requested position in world space. Requested regular lap intervals never exceed **45 m**; the largest gap after projecting actual snapped panorama positions onto the lap is **53.11 m**. Every request returned an official Google panorama. Maximum Google snapping offset: **9.6 m**. Source dates, exact snapped/requested positions, headings, copyright and Maps/thumbnail links are retained in [panorama metadata](references/stations.json) and [coverage audit](survey-coverage.json).

Reviewed reference sheets: [1](survey-01.webp), [2](survey-02.webp), [3](survey-03.webp), [4](survey-04.webp), [5](survey-05.webp), [6](survey-06.webp), [7](survey-07.webp), and the missing-junction sheets [8](junction-survey-01.webp), [9](junction-survey-02.webp), [10](junction-survey-03.webp). The last 15 requests specifically cover junctions on the unused but open arcs of the full squares, where along-route distance alone would have overstated coverage.

All reference panes are labelled **Street View © Google**. They are evidence only: no imagery or photo texture is read by the builders or copied into deployed assets. The shipped rubble pattern is a tiny deterministic authored texture. Only hand-reduced dimensions, colours, street character and existing OSM anchors enter `tools/maps/psychiko/recognition.mjs` and `raw/lap-survey.json`.

## Recognisable landmarks

| In lap order | Modelled cue / source anchor |
| --- | --- |
| Faros | [Faros footprint plan](faros-plan.webp); three commercial fronts: OSM buildings 425080433, 425080449, 425080469; flat roofs, pale walls, shop glazing and orange/blue fascias. |
| Faros / Kifisias | Open 13 m, three-outbound/one-inbound signal mouth tapering to the residential avenue; divided arterial surface lanes, median pieces, overhead signal arms, trolley contact/suspension wires, blue sign gantries and steel frontage separator. |
| Proti Plateia | White periptero 4285024427, set back only onto its pavement; stacked-balcony block 329309489; open planted island and outer pine crowns. |
| Diamantidou / Defteri Plateia | Green periptero 4285022967 with cream canopy; pale villas, balconies, kerb parking, pine canopy and garden railings. |
| Lytra / Paraschou | Cypress-lined unmarked lane followed by the steep descent, pale stone retaining boundaries and dark railings. |
| Davaki | Brown stacked balconies on source footprint 308022552. |
| Venizelou / Stavrou | Open green median, planted circles, lower stone boundaries and pale villa fronts. |
| Bizaniou / Vyzaniou | Continuous rough-stone College wall on the left, 3.25–3.60 m total including a 0.72 m dark railing; green side gate 8694632735; ochre school building 213205098 behind pines. |
| Benaki | College gate 6193531311, high pale stone boundaries, bollards, parked cars, cypresses and pines. |
| Areaki / Michalakopoulou | Pale property wall and climbing flowers, green periptero 3445319234 with canopy, palms and planted square. |
| Malakasi / Kallari | Park fencing and wooded verge on the left, cream villa boundaries on the right, kerbside pines and parked cars. |
| Elikonos light | Existing cream corner-office footprint 425327262, five storeys and blue glazing. |
| Kifisias return | Glass office 425320935, divided surface road, planted separation, overhead wires and the steel separator beside the Faros slip. |

The final camera audit rejected west-side post office 345403871 as the A-square balcony landmark: it projects outside the panorama. Apartment footprint 329309489 projects onto the visible right-hand balcony block and has the matching OSM apartment tag. The Benaki gate opening is on its mapped left side. [Projection and gate audit](landmark-audit.json).

Thirteen anchored kiosk/gate/building records share the existing streetscape cells and materials. There are no landmark lights or per-asset draw calls. Buildings retain OSM footprints; balcony details use the same reduced footprint and support elevations as the building shell. Wall railings use cutout panels with geometric cap/base rails. Parking and boundary type now follow the observed lap sections; street furniture remains outside the racing width and open garden islands.

Orange roadworks were moved farther down ordinary side arms. Faros and Elikonos use low steel separator rails, including short slips where a farther barricade would intersect the course. Their race-only visual and collider still share one record; they disappear in free roam. These steel closures are a game course boundary, not a claim that the real junction is permanently closed.

## Performance and physical verification

Fixed world-space cameras, original Low/High preset settings at 960 × 600, production `buildMapWorld`, race closures and detail On. Full-game matched poses retain the original 800 × 500 camera position/orientation, Mini, day/night and chase/cockpit settings. SwiftShader measurements are triangle/draw counts, not FPS claims.

The terrain keeps its 2.5 m contact lattice and every six-metre shoulder. Its extra refined band behind garden walls was reduced from 12 m to 8 m. Distant side-road submissions and race closures now use distance culling. Building/terrain context remains visible beyond the street furniture.

| Camera | Calls before → after | Triangles before → after | Limit |
| --- | ---: | ---: | ---: |
| Low · matched camera | 85 → 69 | 909,377 → 742,178 | 909,000 |
| Low · Faros start | 285 → 166 | 1,911,246 → 1,430,751 | 1,600,000 |
| High · matched camera | 89 → 81 | 935,487 → 846,421 | 935,000 |
| High · Faros start | 317 → 192 | 2,270,249 → 1,644,785 | 1,700,000 |
| Full game · day-chase | 95 → 79 | 820,779 → 738,647 | 821,000 |
| Full game · day-cockpit | 94 → 78 | 817,023 → 734,891 | 821,000 |
| Full game · night-chase | 97 → 81 | 821,739 → 739,607 | 821,000 |
| Full game · night-cockpit | 96 → 80 | 817,983 → 735,851 | 821,000 |

[Budget assertions](budget-results.json) pass for every supplied limit.

[Low/High measurements and runtime source hashes](harness/perf-final.json), [full-game matched cameras](detail-fixed.json), [current course full-game detail measurements](detail-budget.log), and [unchanged other-map colour branch proof](detail-source-proof.json). The shared building change only uses an optional explicit colour; other maps have no such fields, so their earlier measurements remain equivalent.

The production Mini / RivalAI / Ground drive at 120 Hz completed **5,732.284 m in 502.667 s** with **0 off-road frames, 0 island frames, 0 clockwise steps, 0 wall-hit frames**, visiting all six rings. No teleports or resets: [drive report](lap.json), [log](lap.log). The [onboard strip](onboard-frame-strip.webp) renders actual saved vehicle positions at 1.15 m eye height, using the next physical sample for heading. It is a frame strip, not continuous video.

The initial actual-uploaded-triangle terrain scan covered **3,074,440 samples**. Terrain rises at most **0.0025095 m** above a road (5 mm limit), worst shoulder step **0.1480801 m** (15 cm limit), peak shoulder slope **0.5047527** (below tan 30°). The same scan runs again in the clean archive; its exact final result is below.

## Before / after / Street View evidence

[Review page](review.html), [contact sheet](contact-sheet.webp), [all comparisons in lap order](comparisons.json), and [onboard frame strip](onboard-frame-strip.webp). Each comparison uses the same snapped panorama position, heading, horizontal 90° FOV and approximately 2.5 m eye height for both game panes. Reference snapping and OSM coordinate errors remain visible; pictures are never warped to imply a closer match.

[lap-0000](sbs-lap-0000.webp) · [faros-across](sbs-faros-across.webp) · [lap-0018](sbs-lap-0018.webp) · [lap-0090](sbs-lap-0090.webp) · [lap-0360](sbs-lap-0360.webp) · [lap-0390](sbs-lap-0390.webp) · [lap-0675](sbs-lap-0675.webp) · [lap-0990](sbs-lap-0990.webp) · [lap-1035](sbs-lap-1035.webp) · [lap-1350](sbs-lap-1350.webp) · [lap-1552](sbs-lap-1552.webp) · [lap-1710](sbs-lap-1710.webp) · [lap-1800](sbs-lap-1800.webp) · [lap-1980](sbs-lap-1980.webp) · [lap-2138](sbs-lap-2138.webp) · [lap-2340](sbs-lap-2340.webp) · [lap-2565](sbs-lap-2565.webp) · [lap-2745](sbs-lap-2745.webp) · [lap-2970](sbs-lap-2970.webp) · [lap-3150](sbs-lap-3150.webp) · [lap-3240](sbs-lap-3240.webp) · [lap-3465](sbs-lap-3465.webp) · [lap-3645](sbs-lap-3645.webp) · [lap-3780](sbs-lap-3780.webp) · [lap-4005](sbs-lap-4005.webp) · [lap-4060](sbs-lap-4060.webp) · [lap-4140](sbs-lap-4140.webp) · [lap-4455](sbs-lap-4455.webp) · [lap-4635](sbs-lap-4635.webp) · [lap-4905](sbs-lap-4905.webp) · [lap-5040](sbs-lap-5040.webp) · [lap-5085](sbs-lap-5085.webp) · [lap-5310](sbs-lap-5310.webp) · [lap-5580](sbs-lap-5580.webp)

Raw downloads and individual capture frames were discarded after composition. Metadata paths describe the original captures; the source URLs remain available for refetching. The labelled sheets and triptychs retain every reviewed pane. The extra Faros-across view sits beside the start views. Before panes are the inherited pre-implementation captures; after panes come from the final runtime. The full-game start canvas is retained as a compressed [native game view](faros-game.webp).

## Rebuild and clean-archive gates

`route.mjs`, `build.mjs`, `tools/build-detail-records.mjs`, `preview.mjs` ran twice. The second pass was **byte-identical**, including route/profile, map/terrain and preview; spawn roads were refreshed. [Hash proof](rebuild-hashes.json), [rebuild log](rebuild.log). No other map bundle changed. Horizontal course coordinates, roundabouts and one-way spans are identical to `72ac5c56`; the existing width-aware surface conformance changes a few Faros height samples by at most 0.19 m after the mouth widens. [Scope proof](scope-proof.json).

All requested gates run from one clean `git archive` of the committed candidate, with existing node_modules symlinked. [Tested commit](archive-head.txt), [machine-readable results and owned PIDs](gate-results.json).

| Gate | Exact result |
| --- | --- |
| `npm test` | 252/252 files, 2306 tests, 2291 pass, 3 fail in first attempts, 12 skipped; 0 flaky (passed on isolated retry), 2 failed; only the accepted garage and Riviera cases fail. [Log](npm-test.log). |
| Physics | 1,261 pass / 0 fail. [Log](physics.log). |
| Syntax | Syntax checked 381 JavaScript modules. [Log](syntax.log). |
| Browser imports | Browser import graph checked: 300 modules. [Log](browser-imports.log). |
| Map validator | Pass; worst source-field error 1.08710 m; lap 5,732.284 m; 3,647 buildings and 672 network parts. [Log](validator.log). |
| Focused Psychiko / rings | 44 pass / 0 fail. [Log](focused.log). |
| Uploaded terrain | 1 pass / 0 fail; 3,074,440 samples; above-road 0.00250949 m, step 0.14808014 m, slope 0.50475271. [Log](terrain.log), [summary](terrain-summary.json). |
| AI lap | 502.667 s; 0 off-road, 0 island, 0 clockwise, 0 wall-hit frames; six rings. [Log](lap.log). |
| Current detail budgets | 1 pass / 0 fail. [Log](detail-budget-clean.log). |
| Wrangler deploy dry run | Exit 0; `npx wrangler deploy --env staging --dry-run`; no deployment. [Log](wrangler-dry-run.log). |

## Remaining gaps and cleanup

This is a lightweight reconstruction, with visually estimated widths, storeys, setbacks, wall heights, tree mix and garden planting. Individual trees, ornamental villa arches, exact shop lettering, cable support positions and signal phases are not survey-grade replicas. Signals remain static dressing. Google panoramas span different dates and seasons. The smoothed Copernicus field, omitted Kifisias tunnels, local naming choices and short route connections remain exactly as documented in [implementation D](../impl-d/README.md).

Matched-camera draw calls are below the approximate 100–110 goal. Faros start draw calls remain higher than that broad target; the specific start triangle limits pass. The wider new-course evidence views have no additional triangle promise beyond the supplied matched benchmarks and the start limits.

The repository browser-slot script requires Bash 4 dynamic file descriptors and native flock, neither available on this Mac. [Task-local fallback](browser-slot.py) holds its same advisory slot locks across each headless job. Browser/server PIDs and close results are retained under `harness/` and in the gate records. Only owned handles are closed; no unrelated PID is signalled.

Removed the one task temporary directory `/tmp/athens-psychiko-e.k4ypyto5`, including its 1.2 GB clean archive/bakes, plus 40.3 MiB of raw/duplicate evidence. All recorded final browser/server/gate PIDs have exited; no manual signals were sent. The intentional retained evidence is approximately 19.4 MiB under `impl-e/`. Disk before: 87 GiB available / 12% capacity. Final `df -h /` and precise sizes are in the [cleanup record](cleanup.json). No other worktree, task folder or cache was removed.
