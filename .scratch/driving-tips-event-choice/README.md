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

## Not yet proven
- controller (gamepad) tip screenshot; 720 baseline;
- event flow past setup: CHOOSE CAR → Back (twice: the first Back opens the garage) keeps TIME TRIAL, then starting the time
  trial and the race and checking laps / rivals on track (covered by `tools/setup-event-choice.test.mjs`, not yet in a browser).
