# Free roam picker in the Athens world (2026-10-20)

Owner, on staging `acce710` with `?map=athens`: "I can't click on the map anywhere, and it does not have proper UI in the Athens thing", and "I could not scroll wheel to zoom out, the whole thing felt jank".

`check.mjs` serves a tree locally with the world staging serves. The manifest is `wrangler.jsonc` env.staging `ATHENS_WORLD_MANIFEST`, and both it and its cells are proxied from staging.athensracing.com. It signs in through `server/accounts-stub.mjs`, opens free roam under `?map=athens&menu`, and then:
- steps through every area;
- zooms with Mac-style wheel notches (deltaY multiples of 4.000244) at the cursor and clicks 13 spots;
- checks the +/− keys, drag, trackpad pan and pinch;
- measures a 5 s pan-and-zoom sweep, saves a zoom sequence and presses DRIVE.

- `before/`: prod `acce7101`, plus `owner-staging-acce710.webp` (the owner's screenshot).
- `after/`: the fixed tree. `report.json` holds every number.

## Spots (after)

| Spot | Region | Result | Street | Area card | Snap distance (m) |
|---|---|---|---|---|---|
| Syntagma | centre | ok | ΟΘΩΝΟΣ | SYNTAGMA | 59.8 |
| Omonia | centre | ok | ΠΛΑΤΕΙΑ ΟΜΟΝΟΙΑΣ | EXARCHEIA | 32.1 |
| Kypseli | centre | ok | ΚΑΣΤΕΛΟΡΙΖΟΥ | KYPSELI | 15.2 |
| Marousi | north | ok | 25ΗΣ ΜΑΡΤΙΟΥ | MAROUSI | 25.5 |
| Kifisia | north | ok | NEAR KIFISIA (unnamed road) | KIFISIA | 45.9 |
| Chalandri | north | ok | ΑΓΙΑΣ ΠΑΡΑΣΚΕΥΗΣ | CHALANDRI | 6.3 |
| Peristeri | west | ok | ΜΕΣΟΛΟΓΓΙΟΥ | PERISTERI | 9.9 |
| Aigaleo | west | ok | ΝΙΚΟΛΑΟΥ ΠΛΑΣΤΗΡΑ | AIGALEO | 13.8 |
| Piraeus | coast | ok | ΗΡΩΩΝ ΠΟΛΥΤΕΧΝΕΙΟΥ | PIRAEUS | 16.8 |
| Palaio Faliro | coast | ok | ΑΡΤΕΜΙΔΟΣ | PALAIO FALIRO | 10.5 |
| Glyfada | coast | ok | ΑΓΙΟΥ ΓΕΡΑΣΙΜΟΥ | GLYFADA | 5.5 |
| Voula | coast | ok | ΚΕΦΑΛΛΗΝΙΑΣ | VOULA | 27.5 |
| Saronic sea | sea | ok | No road here (correct) | — | — |

The snap distance is measured from the spot's coordinate, not from the click. The click lands a few pixels off the spot while the zoom is still settling.

Before (prod), 0 of 13: the wheel cannot zoom (scale stays 9.5), so no spot can be reached. The card says ATHENS RIVIERA, and the arrows step ATHENS RIVIERA, MEGARA, PENTELI, PSYCHIKO and ATHENS OPEN WORLD · DEV.

After, the arrows step through 17 districts: Syntagma, Plaka, Kolonaki, Exarcheia, Kypseli, Patisia, Peristeri, Aigaleo, Piraeus, Kallithea, Nea Smyrni, Palaio Faliro, Glyfada, Voula, Chalandri, Marousi and Kifisia.

DRIVE from ΚΑΣΤΕΛΟΡΙΖΟΥ (Kypseli) goes to `?map=athens&spawn=795.2,-2274.7&car=mini_jcw`. The Athens world boots, and the car stands on the street 31 m from the chosen point (the nearest safe tow anchor).

## Input

| | Before | After |
|---|---|---|
| Mac mouse wheel zoom out | no change (9.55 → 9.55) | 20 → 1.17 (the whole map) |
| + / − keys | nothing | 1.86 → 2.98 → 1.90 (perf-only run) |
| Drag pan | ok | ok, 199 px for a 200 px drag (perf-only run) |
| Two-finger trackpad scroll | pans | pans (−78, −39 px) |
| Pinch (ctrl+wheel) | zooms | zooms |

The full run also flagged two checks, both harness timing:
- **+ key:** it started at 63 px/unit, the cap is 64, so it had no room. − went 64 → 40.7.
- **Drag:** it measured 141 px while that zoom was still settling.

## Frame times (5 s pan-and-zoom sweep, 1280×800)

The box was at load average about 36–40 on 8 cores during every run, with other agents' tests, bakes and browsers running. Headless Chrome also composites the 2D canvas in software. Frame intervals here measure that box, not the map. Our own main-thread work per frame (every requestAnimationFrame callback, timed in the page) is the part the code controls:

| | Frame work p50 / p95 / max | rAF interval p50 / p95 |
|---|---|---|
| Before (prod, no street layer) | 0.3 / 18.5 / 33.5 ms | 317 / 483 ms |
| After (all 38k Athens streets) | 0.3 / 12.9 / 15.6 ms | 283 / 450 ms |

Tile paints are sliced across frames within the budget (`tools/map-select-perf.test.mjs`), so the street layer adds no long frames.

After a fast zoom from the basin to street level, the part of the view not yet painted shows a scaled-up coarse tile. It reads as a bright blur for a moment, and on this box for a few seconds. No frame is ever blank. The settled view is crisp (`after/street-level-1280x800.webp`).
