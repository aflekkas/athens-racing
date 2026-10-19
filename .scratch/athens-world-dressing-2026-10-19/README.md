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
