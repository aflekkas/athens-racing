from pathlib import Path
import json,math
p=Path('.scratch/psychiko-realism/impl-d');data=json.loads(Path('data/maps/psychiko/map.json').read_text());r=data['route'];raw=json.loads(Path('tools/maps/psychiko/raw/route.json').read_text());lap=json.loads((p/'lap.json').read_text());grades=[(b-a)/r['step']*100 for a,b in zip(r['y'],r['y'][1:])]
perf=json.loads((p/'harness/perf-final.json').read_text());fixed=json.loads((p/'detail-fixed.json').read_text());baseline={'low':(315,855210),'high':(323,888368)}
rows=[]
for t in perf['rows']:
 old=baseline[t['tier']];v=t['poses'][1]['render'];rows.append(f"| {t['tier'].title()} · same world camera | {old[0]} → {v['calls']} ({(v['calls']/old[0]-1)*100:+.1f}%) | {old[1]:,} → {v['triangles']:,} ({(v['triangles']/old[1]-1)*100:+.2f}%) |")
for t in fixed['rows']:
 a=t['before'];b=t['after'];rows.append(f"| Full game · {t['name'].removeprefix('psychiko-mid-')} | {a['calls']} → {b['calls']} ({(b['calls']/a['calls']-1)*100:+.1f}%) | {a['triangles']:,} → {b['triangles']:,} ({(b['triangles']/a['triangles']-1)*100:+.2f}%) |")
new=[]
for t in perf['rows']:
 for pose in t['poses']:
  if pose['name'] in ['start','course-mid']:new.append(f"| {t['tier'].title()} | {pose['name']} | {pose['render']['calls']} | {pose['render']['triangles']:,} |")
turns='''| 1 | Faros surface signal approach; right into Psychiko on 25is Martiou | 371561413 → 465224134, 661584002, 62331516 |
| 2 | A square / Proti Plateia, CCW; full ring and all its arms remain paved/open | 25053095 |
| 3 | Diamantidou up to B square | 661583999, 25048553, 661583995, 978004329 |
| 4 | B square, CCW; complete ring and internal connectors | 25053533 |
| 5 | Last Diamantidou section, short CCW Eleftherias rim, right Nikiforou Lytra | 661542255, 717372565, 717372563, 246198210 |
| 6 | Left Achillea Paraschou downhill | 97722998 |
| 7 | Dryadon then Pavlou Mela to Davaki | 97723002, 31486851 |
| 8 | Davaki; left/right onto Eleftheriou Venizelou | 193169557, 545649903, 723515844, 661213890, 723515845, 661214619 |
| 9 | CCW roundabout, exit 25is Martiou | 31486843, 31486918, 723515852 |
| 10 | Continue 25is Martiou through the Georgiou Stavrou mini-circle CCW | 661217862, 470144907, 31270163, 661217864 |
| 11 | Sharp right Bizaniou, College wall on left; Korytsas connection to Benaki | 97723004, 31270138, 545646475 |
| 12 | Right Areaki (“Arsaki” in the request) to Michalakopoulou square, CCW | 25053494, 634346640 |
| 13 | West exit onto Miltiadi Malakasi | 25048567, 545646476 |
| 14 | Left Stratigou Kallari, park on the left | 545646479, 468238645, 25053123 |
| 15 | Left Elikonos to the signal | 469423418, 465205391 |
| 16 | Right onto southbound Kifisias; fork onto the surface lanes back to Faros | 662139350, 216905683, 664440151, 465205389, 476108293, 113339579, 371561413 |'''
text=f'''# Psychiko realism implementation D — Faros Circuit v3

Work only in the requested `psychiko-realism` worktree on `vas-per/psychiko-realism`, clean-HEAD reference `c29be743`. Local commits only: no push, PR edit, merge or deployment. All captures use headless Chromium/SwiftShader. The inherited planner and uncommitted route were inspected first and reused after source/direction checks. Temporary regional query dumps and old annotated topology plots were discarded after review; the frozen OSM source remains unchanged.

## Final course and decisions

**{data['length']:,.3f} m/lap**, two race laps (**{2*data['length']:,.3f} m**), two rivals. One timing line/grid/gantry at the Faros light, 16 m before OSM node 1285491927 on the southbound surface approach. Lap finish is the next lap's start; spawn and preview use the same seam. Reverse racing remains disabled everywhere. The six raced rings, every free-roam ring, traffic plans and guidance stay one-way CCW.

| Step | Street / turn | OSM way IDs in driving order |
| --- | --- | --- |
{turns}

The exact node/edge list is `tools/maps/psychiko/raw/drawn-course.json`; `plan-faros.mjs` limits each leg to the reviewed real ways, respects one-way tags and rejects grade-separated ways. The legal sampled chain is `raw/route.json`. [North-up route overlay](route-overlay.webp) shows the lap over the shipped surrounding OSM roads; mint marks the complete A/B rings.

Decisions where the description differs from OSM:

- Faros is a surface signal/frontage junction above/beside the Kifisias tunnel corridor. Follow its real approach onto 25is Martiou; do not invent an at-grade crossing of the tunnel lanes.
- B square's OSM ring name is Eleftheriou Venizelou although the approach/departure are Diamantidou. The right turn at its far end uses the short legal Eleftherias rim before Lytra.
- Paraschou ends at Dryadon, not Davaki. Dryadon/Pavlou Mela provide the actual 101 m connection to Davaki; every edge remains on a real road.
- Bizaniou continues through the short Korytsas link to Benaki. The mapped College boundary is on the left and uses the rough-stone school wall treatment.
- The requested “Arsaki” matches the right turn on way 25053494, named **Αρεακη / Areaki** in this OSM snapshot. At Michalakopoulou square, Makariou 107941912 leads one-way southeast, away from Malakasi. Use the CCW ring's real west Malakasi exit instead of that incompatible ray.
- Elikonos turns onto the legal southbound Kifisias carriageway; its surface frontage fork reaches Faros without using an underpass. Four tunnel ways remain omitted: 25117418, 25117422, 113339568, 113339581. There is no grade separation in the kit.

Free roam has **{len(data['roadNetwork']['roads'])} road parts / {data['roadNetwork']['length']/1000:.3f} km** plus the main lap, including both surface Kifisias directions along the frontage and the new streets beyond the municipal boundary. New Faros/Elikonos named spawns replace two older neighbourhood suggestions, keeping eight choices. Kifisias uses OSM lane-count T10/D8/F5 sections, dashed dividers, median pieces, arterial lamps and signal dressing. Furniture is merged into existing near-prop cells; no extra dynamic lights. Signals are approximate static dressing; this does not add a new timed signal-control simulation.

A/B rings keep every arc and internal approach open. Reviewed connectors 661213888 / 661217861 / 661217863 / 661542256 / 661584000 / 661583998 / 978004330 are part of the open junctions. **{len(data['roadworks'])} physical roadworks closures** cover the remaining public outgoing half-edges in races and vanish in free roam. Their logical roots/colliders survive material/cell batching. Minimap, selector route and detail art, catalogue/menu strings, event distances, multiplayer geometry/lobby checks, AI racing lines and elevation sampling follow this course. Local records and server boards now use **faros-v3**; old garden-v2 records stay stored. Ghost/lobby geometry fingerprints change from the former `653bca47`.

## Elevation and physical verification

Copernicus GLO-30, the existing sigma-20 m spatial field and complete-ring planes. Lap **{min(r['y']):.2f}–{max(r['y']):.2f} m**, ascent/descent **{data['psychiko']['stats']['ascent']:.2f} m**, peak sampled grade **{max(grades):.3f}% up / {-min(grades):.3f}% down**. Symmetric feasible envelopes share the small physical correction between uphill/downhill approaches; source validator bounds the field departure to **1.2 m** and runtime conformance to **1.1 cm**. The final measured worst field departure is in [validator log](validator.log).

Tight real junctions retain roughly 3.6 m minimum radius, so the old course's 6 m-radius assertion is replaced with a 3.5 m bound, while the independent 4.5 m public-street proximity and legal-edge tests remain. The projection tolerance reflects the same approximately 2 m sample spacing. The expanded whole-network prop count remains under one million triangles; actual visible Low/High/full-game costs are checked below. The spawn test now considers all valid junction candidates before checking lane centring, avoiding an almost-parallel neighbouring segment's extended axis.

The unchanged rendered-terrain gate checks **3,074,342** samples over every road and six-metre shoulder. Final pre-archive scan: terrain at most **+0.00251 m** above road (5 mm allowance), largest road/shoulder step **0.14809 m** (15 cm allowance), maximum shoulder slope **0.51057** (below tan 30°). See [clean terrain gate](terrain.log).

[Production AI drive](lap.json), [console proof](lap.log): real Mini `Vehicle`, `RivalAI`, `Ground`, network and race closures, 120 Hz, no teleports or resets. One lap in **{lap['finish']:.3f} s**, **{lap['offRoadFrames']} off-road frames**, **{lap['islandFrames']} island frames**, **{lap['clockwiseSteps']} clockwise steps**, **{lap['wallFrames']} wall-hit frames**, all six rings visited. The onboard strip below renders saved physical drive positions; it is not a continuous video or an FPS measurement.

## Performance

The budget comparison uses the **same world-space camera positions/directions as impl-c**, because a 50%-lap camera and start grid move when the course changes. Low/High: 960×600, actual preset pixel ratio/chunk/draw distance, production `buildMapWorld`, race closures, no player/traffic/HUD/post. Final capture builds the same source geometry at runtime; impl-c's baseline restored its deterministic packed geometry. Full game: original 800×500 camera, Mini, day/night, chase/cockpit, detail On, original terrain-selection reset. No FPS claim under SwiftShader. The +5% draw / +10% triangle limits apply to these supplied matching benchmark poses.

| Matching benchmark | Calls before → after | Triangles before → after |
| --- | ---: | ---: |
{chr(10).join(rows)}

[Low/High measured JSON](harness/perf-final.json), [full-game matching cameras](detail-fixed.json), [capture processes closed](harness/perf-processes-final.json). The requested **unchanged** impl-a detail-budget script was rerun through a PID-recording wrapper; the measured Psychiko-only terrain policy hash is refreshed after that capture, while other maps use unchanged branches; it refreshes the Psychiko rows and current bundle hash in `.scratch/detail-pass/budgets.json` (force-added). [Original new-mid measurements](detail-budget.log). That script's 50%-lap camera is now on a different street; its absolute figures are not the matched-camera comparison.

For transparency, new course views below are different from the old course's start/mid. Faros exposes more of the city than the former Diamantidou grid. Their triangle totals are higher than the matching mid benchmark and do not imply a hardware frame-rate result:

| Preset | Relocated view | Calls | Triangles |
| --- | --- | ---: | ---: |
{chr(10).join(new)}

Calls fall because closures now share spatial/material batches. The 2.5 m contact grid stays intact; its refined band is limited to 12 m past each road rather than 32 m of unused surrounding ground. Road chord tolerance is 2 cm. The uploaded-triangle terrain gate, not a hidden contact proxy, verifies the result.

## Evidence

Game panes use the saved panorama's actual snapped position and heading, horizontal FOV 90°, approximate 2.5 m eye height; reference metadata records offsets (2–14 m, Kalari 3 m) and capture dates. Right panes are labelled **Street View © Google**. Imagery is research only, never an input to builders and never shipped in deployed assets. Geometry, tree species/positions, exact walls, road widths and signal furniture remain class-level estimates, not a survey reconstruction.

- [Faros start](sbs-faros.webp)
- [A square](sbs-plateia-a.webp) and [B square](sbs-plateia-b.webp)
- [Achillea Paraschou descent](sbs-paraschou.webp)
- [Sharp Bizaniou right / College boundary](sbs-vyzaniou.webp)
- [Stratigou Kallari by the park](sbs-kalari.webp)
- [Elikonos → Kifisias light](sbs-elikonos.webp)
- [Onboard AI frame strip](onboard-frame-strip.webp)
- [Native full-game Faros canvas](faros-game.png); the shipped release image is `assets/changelog/2026.10.16.1/psychiko-faros.webp`, 1280 px wide, WebP q75, no harness UI.
- [Panorama metadata](references/stations.json), [game capture metadata](harness/evidence.json), [headless browser/server ownership](harness/evidence-processes.json).

## Rebuild and final gates

`route.mjs`, `build.mjs`, `tools/build-detail-records.mjs`, `preview.mjs` ran twice; the second run is **byte-identical** for route/elevation stations/profile, map/terrain and preview. [SHA-256 proof](rebuild-hashes.json), [rebuild log](rebuild.log). `node tools/build-spawn-roads.mjs` was rerun. Selector assets were refreshed offline with the existing Python pipeline; an unrelated Penteli image encoder difference was discarded.

Final gates use a clean `git archive` of the committed candidate with node_modules symlinked. [Tested commit](archive-head.txt), [machine-readable outcomes](gate-results.json). Gate logs are retained research output and can be updated without changing the tested HEAD.

| Gate | Result / log |
| --- | --- |
| `npm test` | Only the explicitly accepted upstream garage drive-pill browser test and two Riviera traffic cases may fail; [full log](npm-test.log) |
| Physics regression | 1,261 pass / 0 fail; [log](physics.log) |
| Syntax / browser imports | Pass; [syntax](syntax.log), [imports](browser-imports.log) |
| Psychiko validator | Pass; [log](validator.log) |
| Focused Psychiko / roundabouts | 43 pass / 0 fail; [log](focused.log) |
| Uploaded-terrain scan | Pass, unchanged thresholds; [log](terrain.log) |
| AI full lap | Pass, zero departures/island/clockwise frames; [log](lap.log) |
| Current detail budget | Pass; [log](detail-budget-clean.log) |
| `npx wrangler deploy --env staging --dry-run` | Dry-run only, no deployment; [log](wrangler-dry-run.log) |

## Cleanup and limits

Only this task's recorded browser/server handles were closed; no unrelated PID was signalled. The one temporary task directory (clean archive/deploy build) is removed after gates, as are temporary bakes, raw intermediate game frames and redundant query dumps. Retained evidence is reported in the final handoff. Disk before heavy work: 86 GiB available, 13% capacity; final disk/retained sizes are in [cleanup record](cleanup.json). No worktree was created or removed and no branch outside this worktree was changed.

The remaining limitations are the approximate low-poly scenery, static signal dressing, source DSM smoothing, omitted tunnels, software-rendered timing, and the larger amount of visible city at the relocated Faros start. No unreported gate failure is accepted.
'''
(p/'README.md').write_text(text)
