# Driving-controls tip and Race Setup event choice: evidence

Candidate: `03d25288` (on `47d25859`). Baseline: `47d25859`. Our own game only, headless Chromium + SwiftShader, `quality=potato`.
Captured by Claude Opus 5.5 (`claude-opus-5-5`) with the scripts in this folder, one browser job at a time through `tools/browser-slot.sh`.

## Driving-controls tip (Riviera Quick Race, chase camera, fresh 3D frame)

| File | Build | What it shows |
|---|---|---|
| `before-tip-kb-1280x800.jpg` | 47d25859 | the bug: `LMANUAL / AUTOEPADDLE UPQPADDLE DOWNSPACEHANDBRAKEXTC…` |
| `after-tip-kb-1280x800.jpg` | 03d25288 | key-cap / action rows, real first-run schedule (main loop); HIDE TIPS clicked: card gone, `strip:false` saved |
| `after-tip-kb-1280x720.jpg` | 03d25288 | shown in the corner lane at 720 high (card 220×299 at y 112–411), not skipped |
| `after-tip-kb-1920x1080.jpg` | 03d25288 | 300 px lane |
| `after-tip-kb-1280x800-rebind.jpg` | 03d25288 | rebinding followed: POV / OUTSIDE = V, LOOK BACK = N |

`tip-after-report.json` holds the per-variant DOM measurements (rows, box, lane mode, overlaps = 0, no horizontal overflow,
screen-reader line). Its `pad-1280x800-rebind` row measured the controller card in the DOM (RB / LB, Y; no mouse row), but the
screenshot taken right after does not show the card, so the controller variant is **not** proven visually and is not included.
The race starts through `?routes=1&route=riviera-coast` (the Quick Race loader); the first variant advances only `Date.now`
past the tip schedule's 10 s, later variants reset the saved tips and call the same `drivingHints.update()`. The harness holds the
shown tip on screen while SwiftShader screenshots (its normal 6 s would expire mid-capture).

## Race Setup event choice (real menu: Quick Race → picker → SELECT TRACK → Race Setup)

| File | What it shows |
|---|---|
| `after-1-picker.jpg` | picker on Megara Circuit |
| `after-2-setup-default.jpg` | EVENT: RACE selected / TIME TRIAL; 2 rivals; CIRCUIT · 3 LAPS; records request `eventId=megara-race` |
| `after-3-setup-timetrial.jpg` | after clicking TIME TRIAL: no rivals row, 3 laps, TIME TRIAL · 3 LAPS, records request `eventId=megara-tt` |
| `after-single-2-setup-default.jpg` | single-event route (Penteli Descent TT): no EVENT row |
| `after-single-free-session-setup.jpg` | Free Roam session setup: no EVENT row |

`event-choice-*.json` hold the step logs and the leaderboard requests. "Leaderboard unavailable" is expected: the capture
server answers `/api/*` offline except `/api/routes`; `/api/auth/config` is `{providers:[], required:false}`. The route
catalogue, compiled routes and world cells are read-only GETs from our staging site (test input only, not a production claim).

## Added on candidate f88cce4c (08:07–08:10 UTC, one bounded slot)

| File | What it shows |
|---|---|
| `after-tip-pad-1280x800.jpg`, `after-tip-pad-1280x720.jpg` | controller tip, verified in the image (re-measured after the screenshot: still shown): LS, RB / LB, A, D-pad left, Y, VIEW, RS; TOW and BIG MAP have no default controller binding and read UNBOUND; no mouse row |
| `after-1-picker-f88.jpg` | picker with the opaque no-blur card (potato). Not a matched framing: the camera finished its flight to Megara, so no label sits under the card here |
| `after-4-race-timetrial-f88.jpg` | the time trial started from Race Setup: `megara-tt`, timetrial, 3 laps, 0 rivals on the grid, HUD LAP 1/3 |

`event-choice-megara-f88.json`: RACE default (2 rivals) → TIME TRIAL (no rivals, 3 laps) → CHOOSE CAR → Back → Back
(screens `car`, `setup`) keeps TIME TRIAL → time trial on track. `tip-controller-report-f88.json`: controller DOM rows.

## Picker card and race start (f88cce4c, 08:16–08:18 UTC)

| File | What it shows |
|---|---|
| `after-picker-label-under-card-f88.jpg` | matched with the before `after-1-picker.jpg`: the DOM measured PSYCHIKO FAROS CIRCUIT and SYNTAGMA SPRINT under the card; the card paints `rgb(12, 17, 23)` and hides them, the 1 / 6 pager is clean |
| `after-5-race-sprint-f88.jpg` | RACE (the default) started on track: `megara-race`, sprint, 3 laps, 2 rivals set and 2 on the grid, HUD LAP 1/3 |

`picker-and-race-f88.json`: the measurements. The machine reported `data-ui-backdrop=blur`; the card was in its moving state
(`panel--moving`, the map camera settling), which used a 94% tint before this change.

## Not yet proven
- the 720 baseline (before) image; the low/potato tint state was not separately captured (same opaque rule, guarded by
  `tools/float-panel-fallback.test.mjs`).
