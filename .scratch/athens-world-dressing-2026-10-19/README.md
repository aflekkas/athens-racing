# Athens world dressing, 2026-10-19

Owner feedback: no texture on buildings, sea or ground; traffic lights and small details welcome; "all procedural". Docs: [docs/world-dressing.md](../../docs/world-dressing.md).

## Step 1: ground, facades, sea (this folder's `step1/`)

`<place>-<street|above>-before.webp` is prod's runtime on a local bake of the same cells made with prod's generator; `-after.webp` is the step-1 tree on a bake with this commit's generator. 1280 x 800, real app through `tools/browser-slot.sh`, scripts in `scripts/` (`shots.mjs`, `lib.mjs`, `measure.mjs`, `spec*.json`). `*-detail-off-after.webp` is World detail Off. Places: Syntagma (cell 0,0), Plaka (-1,1), Kypseli (1,-4), Glyfada coast (2..3,26) and Piraeus port (-15,9). 16 test cells in all, baked in the author's temp dir with at most 2 to 3 workers; nothing was published or baked into the shared world.

`step1/measure.json`: draw calls, triangles, textures and tile memory in the same four views, World detail On and Off, before and after.

| bytes per cell (test cells) | compressed | resident (manifest `residentBytes`) |
|---|---|---|
| Syntagma 0,0 | 310,244 to 311,860 (+1,616) | 2,929,827 to 3,086,395 (+5.3%) |
| Plaka 0,1 / -1,0 / -1,1 | +1,486 / +1,932 / +1,080 | +6.6% / +9.2% / +9.5% |
| Kypseli 1,-4 / 1,-3 | +2,714 / +1,223 | +5.4% / +4.0% |
| Glyfada coast 4,25 / 3,25 / 2,26 / 3,26 / 2,27 | +2.0 to +5.4 KB | +1.1% to +8.5% |
| Piraeus -15,8 / -15,9 / -14,8 | +1,707 / +3,632 / +1,211 | +5.3% / +5.4% / +6.5% |

## Step 2: working traffic signals (`step2/`)

`signals-*-before.webp` is the step-1 tree on the test bake (no signals); `-after.webp` is this commit: street view, close-ups at red, amber and green (the near head belongs to one approach, the far head to the cross street, so they show opposite phases) and an overhead view of the Syntagma junction at cell 0,0 (494, 443). The after shots also show the street lamps and one-way signs of step 3, because the test bake and the layer carry both; `measure.json` is the same combined layer. `signals-ai.json`: the AI evidence described in docs/world-dressing.md (script `scripts/signals-ai.mjs`).

## Step 3: street details (`step3/`)

`<cell>-<kind>-before.webp` is the step-2 state (signals only: a bake with this commit's generator but `FURNITURE=False`, the step-2 tree's generator); `-after.webp` is this commit. One shot per model, each placed beside a real instance on the side the model faces: kiosk (periptero), bus shelter and stop, bench, fountain, monument, street lamp, one-way sign, pedestrian-crossing sign (Syntagma, cell 0,0), parked cars, stop sign, bus stop, bollard, kiosk, shelter, fountain (Piraeus, cells -14,8 and -15,8). `scripts/mkspec.mjs` writes `scripts/spec-furniture.json` from the baked rows. `measure.json`: draw calls and triangles of the whole layer, On and Off, against the step-1 tree on the same cells.
